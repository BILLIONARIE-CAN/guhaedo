// 실거래가 조회 - /api/trade?code=KAPT_CODE
// 단일 월 스트리밍: ?code=XXX&ym=YYYYMM
// Supabase 캐시: 2개월 이상 지난 월은 영구, 최근 2개월은 24h TTL

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function supaHeaders() {
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
}

// 캐시 조회
async function getCached(code, ym) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/apt_transactions?kapt_code=eq.${encodeURIComponent(code)}&ym=eq.${ym}&select=buy,jeonse,monthly,lawd_cd,apt_name,fetched_at`,
      { headers: supaHeaders(), signal: AbortSignal.timeout(2500) }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows[0]) return null;
    const row = rows[0];
    // 2개월 이상 지난 월: 영구 유효
    const ymDate = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(4,6))-1, 1);
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-2);
    if (ymDate < cutoff) return row;
    // 최근 2개월: 24시간 TTL
    if (Date.now() - new Date(row.fetched_at).getTime() < 86400000) return row;
    return null;
  } catch { return null; }
}

// 캐시 저장 (fire-and-forget)
function setCached(code, ym, data) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/apt_transactions`, {
    method: 'POST',
    headers: { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      kapt_code: code, ym,
      buy: data.buy, jeonse: data.jeonse, monthly: data.monthly,
      lawd_cd: data.lawdCd, apt_name: data.aptName,
      fetched_at: new Date().toISOString()
    }),
    signal: AbortSignal.timeout(4000)
  }).catch(() => {});
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store'); // Supabase가 캐시 담당

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code 필요' });

  const ym = req.query.ym;

  // ── Supabase 캐시 히트 (단일 월 모드만) ──
  if (ym) {
    const cached = await getCached(code, ym);
    if (cached) {
      return res.status(200).json({
        aptName: cached.apt_name || '',
        lawdCd:  cached.lawd_cd  || '',
        buy:     cached.buy      || [],
        jeonse:  cached.jeonse   || [],
        monthly: cached.monthly  || [],
        fromCache: true
      });
    }
  }

  const KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');

  // lawdCd / aptName 결정
  let lawdCd = req.query.lawdCd || '';
  let aptName = req.query.aptName ? decodeURIComponent(req.query.aptName) : '';

  if (!lawdCd || !aptName) {
    if (code.startsWith('DISC_')) {
      const parts = code.split('_');
      lawdCd = parts[1];
      aptName = parts.slice(2).join('_');
      if (!lawdCd || lawdCd.length !== 5) return res.status(400).json({ error: '잘못된 DISC 코드' });
    } else {
      let item;
      try {
        const v4 = await fetch(
          `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${code}&_type=json`,
          { signal: AbortSignal.timeout(7000) }
        );
        item = (await v4.json())?.response?.body?.item;
      } catch(e) {}
      if (!item) return res.status(404).json({ error: '단지 정보 없음' });
      const bjdCode = item.bjdCode || '';
      aptName = (item.kaptName || '').trim();
      lawdCd = bjdCode.substring(0, 5);
      if (lawdCd.length < 5) return res.status(400).json({ error: 'lawd_cd 없음' });
    }
  }

  // 조회 월 목록
  let months = [];
  if (ym) {
    months = [ym];
  } else {
    const monthCount = Math.min(parseInt(req.query.months) || 24, 24);
    const now = new Date();
    for (let i = 0; i < monthCount; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }

  function parseItems(json) {
    const raw = json?.response?.body?.items?.item;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }
  function parsePrice(s) { return parseInt(String(s || '0').replace(/[^0-9]/g, '')) || 0; }

  const aptJibun = (req.query.jibun || '').replace(/[^0-9]/g, '');

  function nameMatch(nm) {
    if (!nm) return false;
    // 공백·괄호 제거 후 완전 일치만 허용
    const normalize = s => s.trim().replace(/[\s()（）·\-]/g, '');
    const n = normalize(nm);
    const an = normalize(aptName);
    return n === an;
  }

  function aptMatch(x) {
    // 이름 완전 일치만 사용 (jibun 매칭 제거 - 구 단지 오염 방지)
    return nameMatch(x.aptNm);
  }

  const buyBase  = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
  const rentBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

  const [buyRaw, rentRaw] = await Promise.all([
    Promise.all(months.map(m =>
      fetch(`${buyBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${m}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    )),
    Promise.all(months.map(m =>
      fetch(`${rentBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${m}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    ))
  ]);

  const buy = buyRaw.flat().filter(x => aptMatch(x)).map(x => ({
    t: `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth)||1).padStart(2,'0')}`,
    day: String(x.dealDay||'').trim(), p: parsePrice(x.dealAmount),
    a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
  }));

  const allRent = rentRaw.flat().filter(x => aptMatch(x));

  const jeonse = allRent.filter(x => !parsePrice(x.monthlyRent)).map(x => ({
    t: `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth)||1).padStart(2,'0')}`,
    day: String(x.dealDay||'').trim(), p: parsePrice(x.deposit),
    a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
  }));

  const monthly = allRent.filter(x => parsePrice(x.monthlyRent) > 0).map(x => ({
    t: `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth)||1).padStart(2,'0')}`,
    day: String(x.dealDay||'').trim(), d: parsePrice(x.deposit),
    m: parsePrice(x.monthlyRent), a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
  }));

  // 캐시 저장 (응답 블로킹 없음)
  if (ym) setCached(code, ym, { buy, jeonse, monthly, lawdCd, aptName });

  return res.status(200).json({ aptName, lawdCd, buy, jeonse, monthly });
}
