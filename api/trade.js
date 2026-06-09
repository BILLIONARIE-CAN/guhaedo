// 실거래가 조회 - /api/trade?code=KAPT_CODE
// 매매(buy) + 전월세(jeonse/monthly) 최근 24개월 데이터 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code 필요' });

  const KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');

  let lawdCd, aptName;

  if (code.startsWith('DISC_')) {
    // discover.js로 추가된 미등록 아파트: DISC_{lawd_cd}_{공백제거_이름}
    const parts = code.split('_');
    lawdCd = parts[1];
    aptName = parts.slice(2).join('_');
    if (!lawdCd || lawdCd.length !== 5) return res.status(400).json({ error: '잘못된 DISC 코드' });
  } else {
    // 1. V4 API로 bjdCode, 단지명 가져오기
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

  // 2. 최근 24개월 목록
  const months = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  function parseItems(json) {
    const raw = json?.response?.body?.items?.item;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }
  function parsePrice(s) { return parseInt(String(s || '0').replace(/[^0-9]/g, '')) || 0; }
  function nameMatch(nm) {
    if (!nm) return false;
    const n = nm.trim();
    if (n === aptName) return true;
    // 단지명 4글자 이상일 때 포함 여부
    const short = aptName.replace(/\s/g, '').substring(0, 5);
    return short.length >= 3 && n.replace(/\s/g, '').includes(short);
  }

  // 3. 매매 + 전월세 병렬 조회
  const buyBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
  const rentBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

  const [buyRaw, rentRaw] = await Promise.all([
    Promise.all(months.map(ym =>
      fetch(`${buyBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(8000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    )),
    Promise.all(months.map(ym =>
      fetch(`${rentBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(8000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    ))
  ]);

  const allBuy  = buyRaw.flat().filter(x => nameMatch(x.aptNm));
  const allRent = rentRaw.flat().filter(x => nameMatch(x.aptNm));

  const buy = allBuy.map(x => ({
    t: `${x.dealYear}-${String(x.dealMonth || 1).padStart(2, '0')}`,
    day: String(x.dealDay || '').trim(),
    p: parsePrice(x.dealAmount),
    a: parseFloat(x.excluUseAr || 0),
    f: String(x.floor || '').trim(),
  }));

  const jeonse = allRent
    .filter(x => !parsePrice(x.monthlyRent))
    .map(x => ({
      t: `${x.dealYear}-${String(x.dealMonth || 1).padStart(2, '0')}`,
      day: String(x.dealDay || '').trim(),
      p: parsePrice(x.deposit),
      a: parseFloat(x.excluUseAr || 0),
    }));

  const monthly = allRent
    .filter(x => parsePrice(x.monthlyRent) > 0)
    .map(x => ({
      t: `${x.dealYear}-${String(x.dealMonth || 1).padStart(2, '0')}`,
      day: String(x.dealDay || '').trim(),
      d: parsePrice(x.deposit),
      m: parsePrice(x.monthlyRent),
      a: parseFloat(x.excluUseAr || 0),
    }));

  return res.status(200).json({ aptName, buy, jeonse, monthly });
}
