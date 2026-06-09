// 미등록 아파트 발견 및 추가 - /api/discover
// GET /api/discover?secret=XXX&lawd_cd=XXXXX&sido=시도명&sigungu=시군구명&months=3&dry_run=false

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const SECRET = 'guh2024xK9mPq7';
  const KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');
  const KAKAO_KEY = 'be82d140cac4386ee76d82cc16c65c3e';

  if (req.query.secret !== SECRET) return res.status(403).json({ error: '인증 실패' });

  const { lawd_cd, sido, sigungu, months: monthsParam = '3', dry_run } = req.query;
  if (!lawd_cd || lawd_cd.length !== 5) return res.status(400).json({ error: 'lawd_cd 5자리 필요' });
  if (!sido || !sigungu) return res.status(400).json({ error: 'sido, sigungu 필요' });

  const months = Math.min(parseInt(monthsParam) || 3, 24);
  const isDry = dry_run === 'true';

  // 1. 최근 N개월 목록 생성
  const ymList = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    ymList.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // 2. 매매 + 전월세 병렬 조회
  function parseItems(json) {
    const raw = json?.response?.body?.items?.item;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  const buyBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
  const rentBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

  const [buyResults, rentResults] = await Promise.all([
    Promise.all(ymList.map(ym =>
      fetch(`${buyBase}?serviceKey=${KEY}&LAWD_CD=${lawd_cd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`,
        { signal: AbortSignal.timeout(8000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    )),
    Promise.all(ymList.map(ym =>
      fetch(`${rentBase}?serviceKey=${KEY}&LAWD_CD=${lawd_cd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`,
        { signal: AbortSignal.timeout(8000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    ))
  ]);

  // 3. 고유 아파트 목록 추출 (이름+동 기준)
  const aptMap = new Map();
  for (const x of [...buyResults.flat(), ...rentResults.flat()]) {
    if (!x.aptNm || !x.umdNm) continue;
    const key = `${x.aptNm.trim()}__${x.umdNm.trim()}`;
    if (!aptMap.has(key)) {
      aptMap.set(key, {
        aptNm: x.aptNm.trim(),
        umdNm: x.umdNm.trim(),
        jibun: (x.jibun || '').trim(),
        buildYear: x.buildYear || null,
      });
    }
  }
  const uniqueApts = [...aptMap.values()];

  // 4. Supabase 기존 아파트 이름 목록 (시군구 내 전체)
  let existingNames = new Set();
  try {
    let offset = 0;
    while (true) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/apartments?select=name&sigungu=eq.${encodeURIComponent(sigungu)}&limit=1000&offset=${offset}`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) break;
      data.forEach(d => { if (d.name) existingNames.add(d.name.replace(/\s/g, '')); });
      if (data.length < 1000) break;
      offset += 1000;
    }
  } catch(e) {}

  // 5. 미등록 아파트 필터 (이름 부분 매칭)
  const missing = uniqueApts.filter(apt => {
    const nm = apt.aptNm.replace(/\s/g, '');
    const short = nm.substring(0, 5);
    if (short.length < 3) return false;
    for (const existing of existingNames) {
      if (existing.length < 3) continue;
      if (existing.includes(short) || nm.includes(existing.substring(0, 5))) return false;
    }
    return true;
  });

  // dry_run: 추가 없이 결과만 반환
  if (isDry || missing.length === 0) {
    return res.status(200).json({
      total_in_transactions: uniqueApts.length,
      already_in_db: uniqueApts.length - missing.length,
      missing_count: missing.length,
      missing: missing.map(a => `${a.aptNm} (${a.umdNm} ${a.jibun}번지)`),
      dry_run: true,
    });
  }

  // 6. 지오코딩 + Supabase 삽입
  let added = 0, failedGeocode = 0;
  const addedList = [];

  for (const apt of missing) {
    // Kakao 주소 검색
    let lat = null, lng = null;
    const addrQuery = `${sido} ${sigungu} ${apt.umdNm} ${apt.jibun}`.trim();
    try {
      const geoRes = await fetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addrQuery)}`,
        { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` }, signal: AbortSignal.timeout(5000) }
      );
      const geoData = await geoRes.json();
      if (geoData.documents?.length > 0) {
        lat = parseFloat(geoData.documents[0].y);
        lng = parseFloat(geoData.documents[0].x);
      }
    } catch(e) {}

    // 주소 검색 실패 시 키워드 검색으로 재시도
    if (!lat) {
      try {
        const kwRes = await fetch(
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(apt.aptNm + ' ' + sigungu)}&size=1`,
          { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` }, signal: AbortSignal.timeout(5000) }
        );
        const kwData = await kwRes.json();
        if (kwData.documents?.length > 0) {
          lat = parseFloat(kwData.documents[0].y);
          lng = parseFloat(kwData.documents[0].x);
        }
      } catch(e) {}
    }

    if (!lat || !lng) { failedGeocode++; continue; }

    // kapt_code: DISC_{lawd_cd}_{공백제거_이름} — trade.js에서 lawd_cd와 이름 추출 가능
    const normalizedName = apt.aptNm.replace(/\s/g, '');
    const kaptCode = `DISC_${lawd_cd}_${normalizedName}`;
    const addr = `${sido} ${sigungu} ${apt.umdNm} ${apt.jibun}번지`.trim();

    try {
      const insertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/apartments`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal,resolution=ignore-duplicates',
          },
          body: JSON.stringify({
            kapt_code: kaptCode,
            name: apt.aptNm,
            addr,
            lat,
            lng,
            sido,
            sigungu,
            dong: apt.umdNm,
            built_year: apt.buildYear ? parseInt(apt.buildYear) : null,
            type: '아파트',
          }),
        }
      );
      if (insertRes.status === 201 || insertRes.status === 200 || insertRes.status === 204) {
        added++;
        addedList.push({ name: apt.aptNm, addr, lat, lng, kaptCode });
      }
    } catch(e) {}

    // Kakao API 부하 방지
    await new Promise(r => setTimeout(r, 200));
  }

  return res.status(200).json({
    total_in_transactions: uniqueApts.length,
    already_in_db: uniqueApts.length - missing.length,
    missing_count: missing.length,
    added,
    failed_geocode: failedGeocode,
    added_list: addedList,
  });
}
