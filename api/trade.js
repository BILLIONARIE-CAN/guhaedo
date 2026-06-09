// 실거래가 조회 - /api/trade?code=KAPT_CODE
// 모드1: ?code=XXX                  - 기본 24개월
// 모드2: ?code=XXX&months=N         - N개월
// 모드3: ?code=XXX&ym=YYYYMM        - 단일 월 (스트리밍용)
//   lawdCd, aptName 파라미터 전달 시 V4 API 스킵 → 빠름

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code 필요' });

  const KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');

  // 클라이언트가 lawdCd/aptName 전달하면 V4 API 스킵 (23개월 요청 최적화)
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

  // 조회 월 목록 결정
  let months = [];
  if (req.query.ym) {
    months = [req.query.ym]; // 단일 월 모드
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
  // 지번 폴백용: 클라이언트가 jibunAddr에서 파싱해서 전달
  const aptJibun = (req.query.jibun || '').replace(/[^0-9]/g, '');

  function nameMatch(nm) {
    if (!nm) return false;
    const n = nm.trim().replace(/\s/g, '');
    const an = aptName.replace(/\s/g, '');
    if (n === an) return true;
    // 완전 포함 여부 (양방향)
    if (n.includes(an) || an.includes(n)) return true;
    // 5자 슬라이딩 윈도우: 앞에 지역명이 붙어도 중간 매칭 가능
    // 예: "탕정삼성트라팰리스" → 윈도우 "삼성트라팰" → "삼성트라팰리스" 매칭
    const wLen = 5;
    if (an.length >= wLen) {
      for (let i = 0; i <= an.length - wLen; i++) {
        if (n.includes(an.substring(i, i + wLen))) return true;
      }
    }
    return false;
  }

  // 이름 매칭 실패 시 지번으로 폴백
  function aptMatch(x) {
    if (nameMatch(x.aptNm)) return true;
    if (!aptJibun || !x.jibun) return false;
    const txJibun = String(x.jibun).trim().split('-')[0].replace(/[^0-9]/g, '');
    return txJibun.length > 0 && txJibun === aptJibun;
  }

  // 3. 매매 + 전월세 병렬 조회
  const buyBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
  const rentBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

  const [buyRaw, rentRaw] = await Promise.all([
    Promise.all(months.map(ym =>
      fetch(`${buyBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    )),
    Promise.all(months.map(ym =>
      fetch(`${rentBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    ))
  ]);

  const allBuy  = buyRaw.flat().filter(x => aptMatch(x));
  const allRent = rentRaw.flat().filter(x => aptMatch(x));

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
      f: String(x.floor || '').trim(),
    }));

  const monthly = allRent
    .filter(x => parsePrice(x.monthlyRent) > 0)
    .map(x => ({
      t: `${x.dealYear}-${String(x.dealMonth || 1).padStart(2, '0')}`,
      day: String(x.dealDay || '').trim(),
      d: parsePrice(x.deposit),
      m: parsePrice(x.monthlyRent),
      a: parseFloat(x.excluUseAr || 0),
      f: String(x.floor || '').trim(),
    }));

  // lawdCd도 반환 → 클라이언트가 다음 요청에 재사용 (V4 스킵)
  return res.status(200).json({ aptName, lawdCd, buy, jeonse, monthly });
}
