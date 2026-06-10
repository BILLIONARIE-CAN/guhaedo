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
  let aptLegalDong = req.query.legalDong ? decodeURIComponent(req.query.legalDong) : '';
  let aptJibunNum  = parseInt(req.query.jibunNum || '0') || 0;

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

      // 법정동명 + 지번 본번 추출 (kaptAddr: "충남 아산시 배방읍 용곡리 123-4")
      const kaptAddr = (item.kaptAddr || '').trim();
      if (kaptAddr) {
        const parts = kaptAddr.replace(/\s+/g, ' ').split(' ');
        // 마지막 토큰: 지번 ("123-4" → 본번 123)
        const lastPart = parts[parts.length - 1] || '';
        if (/^\d/.test(lastPart)) {
          aptJibunNum = parseInt(lastPart.split('-')[0]) || 0;
        }
        // 시군구(시/군/구로 끝나는 토큰) 이후 첫 번째 동/읍/면/리 = 법정동명
        let passedGungu = false;
        for (const p of parts.slice(0, -1)) {
          if (!passedGungu) { if (/[시군구]$/.test(p)) passedGungu = true; continue; }
          if (/[동읍면리]$/.test(p)) { aptLegalDong = p; break; }
        }
      }
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

  // 준공년도 (프론트에서 전달 → 건축년도 크로스체크용)
  const builtYear = parseInt(req.query.builtYear || '0') || 0;

  function nameMatch(nm) {
    if (!nm) return false;
    // 공백·괄호·특수문자 제거 후 완전 일치
    const normalize = s => s.trim().replace(/[\s()（）·\-·\/]/g, '').replace(/[A-Za-z]/g, s => s.toUpperCase());
    const n = normalize(nm);
    const an = normalize(aptName);
    if (n === an) return true;
    // K-apt명 vs 국토부명 차이 허용: 한쪽이 다른쪽의 접두어인 경우 (단지번호 suffix만 다를 때)
    // 예: "래미안동탄" === "래미안동탄1단지".substring(0, 6) 는 허용 안 함
    // → 완전 일치만 허용 (위에서 끝)
    return false;
  }

  // 건축년도 일치 여부 (builtYear 있을 때만)
  function buildYearMatch(x) {
    if (!builtYear) return true;
    const by = parseInt(x.buildYear || '0');
    if (!by) return true; // buildYear 필드 없으면 통과
    // 준공년도 ±1년 범위만 허용 (예: 2026년 준공 → 2025~2027만 허용)
    return by >= builtYear - 1 && by <= builtYear + 1;
  }

  // 법정동명 일치 (umdNm 필드: "배방읍", "개포동" 등)
  function dongMatch(x) {
    if (!aptLegalDong) return true;
    const xDong = (x.umdNm || '').trim().replace(/\s/g, '');
    const myDong = aptLegalDong.replace(/\s/g, '');
    if (!xDong) return true;
    return xDong === myDong || xDong.includes(myDong) || myDong.includes(xDong);
  }

  // 지번 본번 일치 (jibun 필드: "123" or "123-4")
  function jibunMatch(x) {
    if (!aptJibunNum) return true;
    const xJibun = parseInt((x.jibun || '0').split('-')[0]) || 0;
    if (!xJibun) return true;
    return xJibun === aptJibunNum;
  }

  function aptMatch(x) {
    if ((x.cdealType || '').trim()) return false; // 계약 해제된 거래 제외
    return nameMatch(x.aptNm) && buildYearMatch(x) && dongMatch(x) && jibunMatch(x);
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

  return res.status(200).json({ aptName, lawdCd, legalDong: aptLegalDong, jibunNum: aptJibunNum, buy, jeonse, monthly });
}
