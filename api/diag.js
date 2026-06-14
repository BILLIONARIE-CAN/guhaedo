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

// 거래 1건 → 압축 (매칭용 n/d/j/by/c + 수집기용 거래상세 y/m/dy/p/a/f/dep/rent/own)
function priceN(s) { return parseInt(String(s || '0').replace(/[^0-9]/g, '')) || 0; }
function compact(x) {
  return {
    n: String(x.aptNm || '').trim(),
    d: String(x.umdNm || '').trim(),
    j: String(x.jibun || '').trim(),
    by: parseInt(x.buildYear || '0') || 0,
    c: (String(x.cdealType || '').trim()) ? 1 : 0,
    y: parseInt(x.dealYear) || 0, m: parseInt(x.dealMonth) || 0, dy: parseInt(x.dealDay) || 0,
    p: priceN(x.dealAmount), a: parseFloat(x.excluUseAr || 0) || 0, f: String(x.floor || '').trim(),
    dep: priceN(x.deposit), rent: priceN(x.monthlyRent),
    own: String(x.ownershipGbn || '').trim().startsWith('입') ? 2 : (x.ownershipGbn ? 1 : 0)
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
          // 거래상세 필드(v2) 이전 캐시 무효 — 수집기가 가격 정보를 못 받는 사고 방지
          if (new Date(row.fetched_at).getTime() < Date.parse('2026-06-12T10:00:00Z')) throw new Error('stale');
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
    // 분양권(SilvTrade)은 간헐적으로 타임아웃 → 실패해도 매매/전월세 수집을 막지 않도록 격리.
    // (이 "한 줄 실패 = 그 달 통째 폐기" 구조가 전국 사전적재 백필을 0%로 멈춰 세웠던 원인)
    async function callApi(base, ms) {
      const r = await fetch(`${base}?serviceKey=${API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&numOfRows=2000&_type=json`, { signal: AbortSignal.timeout(ms) });
      const j = await r.json();
      const rc = j?.response?.header?.resultCode;
      if (rc && rc !== '00' && rc !== '000') throw new Error('resultCode ' + rc);
      return parseItems(j).map(compact);
    }
    const out = { buy: [], rent: [], pre: [] };
    let errBuy = false, errRent = false, errPre = false;
    await Promise.all([
      callApi(bases.buy, 8000).then(v => { out.buy = v; }).catch(() => { errBuy = true; }),
      callApi(bases.rent, 8000).then(v => { out.rent = v; }).catch(() => { errRent = true; }),
      // 분양권: 1차 실패 시 더 긴 타임아웃으로 1회 재시도, 그래도 실패하면 빈 배열로 진행
      callApi(bases.pre, 8000).then(v => { out.pre = v; })
        .catch(() => callApi(bases.pre, 15000).then(v => { out.pre = v; }).catch(() => { errPre = true; }))
    ]);

    // 매매·전월세가 성공했으면 분양권이 빠져도 "성공"으로 본다 → 수집기가 그 달을 저장한다.
    const criticalError = errBuy || errRent;

    // 3. 캐시 저장 (핵심 데이터 정상일 때만 — 빈 데이터 박제 방지. 분양권 누락은 허용)
    if (!criticalError && SUPABASE_URL && SUPABASE_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/district_cache`, {
        method: 'POST',
        headers: supaHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify({ lawd_cd: lawdCd, ym, buy: out.buy, rent: out.rent, pre: out.pre, fetched_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(4000)
      }).catch(() => {});
    }

    return res.status(200).json({ buy: out.buy, rent: out.rent, pre: out.pre, apiError: criticalError || undefined, preError: errPre || undefined });
  }

  // ───────────────── 청약홈 프록시 (GitHub Actions 해외IP 차단 우회) ─────────────────
  if (op === 'applyhome') {
    const svc = req.query.svc === 'cmpet'
      ? 'ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet'
      : 'ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail';
    const page = parseInt(req.query.page || '1') || 1;
    const perPage = Math.min(parseInt(req.query.perPage || '100') || 100, 100);
    let url = `https://api.odcloud.kr/api/${svc}?page=${page}&perPage=${perPage}&serviceKey=${API_KEY}`;
    if (req.query.since && /^[\d-]+$/.test(req.query.since)) url += `&${encodeURIComponent('cond[RCRIT_PBLANC_DE::GTE]')}=${req.query.since}`;
    if (req.query.houseNo && /^[\w]+$/.test(req.query.houseNo)) url += `&${encodeURIComponent('cond[HOUSE_MANAGE_NO::EQ]')}=${req.query.houseNo}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      return res.status(200).json(await r.json());
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
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
