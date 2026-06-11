// 진단 API - 마스터 페이지 전용
// op=district : ?lawdCd=44200&ym=202605 → 시군구 한 달 전체 거래 (Supabase district_cache 캐싱)
//               같은 시군구 단지들이 이 한 번의 호출을 공유 → 단지별 API 호출 불필요
// op=metalist : POST {codes:[...]} → apartments 테이블의 건축물대장 메타 (far,bcr,use_date 등)
// op=fixmeta  : POST {code, fields:{far,bcr,...}} → apartments 수동 수정 저장

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const API_KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');

function supaHeaders(extra) {
  return Object.assign({ 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }, extra || {});
}

function parseItems(json) {
  const raw = json?.response?.body?.items?.item;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

// 거래 1건 → 진단용 압축 (n=단지명, d=법정동, j=지번, by=건축년도, c=해제여부)
function compact(x) {
  return {
    n: String(x.aptNm || '').trim(),
    d: String(x.umdNm || '').trim(),
    j: String(x.jibun || '').trim(),
    by: parseInt(x.buildYear || '0') || 0,
    c: (String(x.cdealType || '').trim()) ? 1 : 0
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');

  const op = req.query.op || 'district';

  // ───────────────── 시군구 한 달 거래 (캐시 공유) ─────────────────
  if (op === 'district') {
    const lawdCd = String(req.query.lawdCd || '');
    const ym = String(req.query.ym || '');
    if (!/^\d{5}$/.test(lawdCd) || !/^\d{6}$/.test(ym)) return res.status(400).json({ error: 'lawdCd(5자리)/ym(6자리) 필요' });

    // 1. 캐시 확인 (2개월 이상 지난 월 = 영구, 최근 월 = 24h)
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/district_cache?lawd_cd=eq.${lawdCd}&ym=eq.${ym}&select=buy,rent,pre,fetched_at`,
          { headers: supaHeaders(), signal: AbortSignal.timeout(2500) }
        );
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]) {
          const row = rows[0];
          const ymDate = new Date(parseInt(ym.slice(0, 4)), parseInt(ym.slice(4, 6)) - 1, 1);
          const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 2);
          const fresh = ymDate < cutoff || (Date.now() - new Date(row.fetched_at).getTime() < 86400000);
          if (fresh) return res.status(200).json({ buy: row.buy || [], rent: row.rent || [], pre: row.pre || [], fromCache: true });
        }
      } catch {}
    }

    // 2. 국토부 API 3종 호출
    const bases = {
      buy:  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
      rent: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
      pre:  'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade'
    };
    const out = {};
    let anyError = false;
    await Promise.all(Object.keys(bases).map(async k => {
      try {
        const r = await fetch(`${bases[k]}?serviceKey=${API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&numOfRows=2000&_type=json`, { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        const code = j?.response?.header?.resultCode;
        if (code && code !== '00' && code !== '000') { anyError = true; out[k] = []; return; }
        out[k] = parseItems(j).map(compact);
      } catch { anyError = true; out[k] = []; }
    }));

    // 3. 캐시 저장 (API 오류 시엔 저장 안 함 — 빈 데이터 박제 방지)
    if (!anyError && SUPABASE_URL && SUPABASE_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/district_cache`, {
        method: 'POST',
        headers: supaHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify({ lawd_cd: lawdCd, ym, buy: out.buy, rent: out.rent, pre: out.pre, fetched_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(4000)
      }).catch(() => {});
    }

    return res.status(200).json({ buy: out.buy, rent: out.rent, pre: out.pre, apiError: anyError || undefined });
  }

  // ───────────────── 건축물대장 메타 일괄 조회 ─────────────────
  if (op === 'metalist') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST 필요' });
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const codes = Array.isArray(body?.codes) ? body.codes.filter(c => /^[A-Za-z0-9]+$/.test(String(c))).slice(0, 400) : [];
    if (!codes.length) return res.status(400).json({ error: 'codes 배열 필요' });
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/apartments?kapt_code=in.(${codes.map(c => `"${c}"`).join(',')})&select=kapt_code,far,bcr,use_date,heat_name,sale_name,total_park`,
        { headers: supaHeaders(), signal: AbortSignal.timeout(8000) }
      );
      const rows = await r.json();
      return res.status(200).json(Array.isArray(rows) ? rows : []);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ───────────────── 건축물대장 메타 수동 수정 ─────────────────
  if (op === 'fixmeta') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST 필요' });
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const code = String(body?.code || '');
    if (!/^[A-Za-z0-9]+$/.test(code)) return res.status(400).json({ error: 'code 필요' });
    const ALLOW = ['far', 'bcr', 'use_date', 'heat_name', 'sale_name', 'total_park'];
    const fields = {};
    for (const k of ALLOW) {
      if (body?.fields && body.fields[k] !== undefined && body.fields[k] !== '') fields[k] = body.fields[k];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: '수정할 필드 없음' });
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/apartments?kapt_code=eq.${code}`, {
        method: 'PATCH',
        headers: supaHeaders({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify(fields),
        signal: AbortSignal.timeout(6000)
      });
      if (!r.ok) return res.status(500).json({ error: 'Supabase 저장 실패 ' + r.status });
      return res.status(200).json({ ok: true, saved: fields });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: '알 수 없는 op' });
}
