export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=86400'); // 24시간 캐시

  const { type, code } = req.query;
  const API_KEY = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';

  let url = '';

  if (type === 'list') {
    const sidoCode = code.substring(0, 2) + '00';
    url = `https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3?serviceKey=${API_KEY}&sidoCode=${sidoCode}&sigunguCode=${code}&numOfRows=1000&pageNo=1&_type=json`;
  } else if (type === 'info') {
    url = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${API_KEY}&kaptCode=${code}&_type=json`;
  } else if (type === 'bulk') {
    // 여러 단지 기본정보 한 번에 처리
    const codes = code.split(',').slice(0, 50); // 최대 50개씩
    const results = await Promise.all(
      codes.map(async (kaptCode) => {
        try {
          const infoUrl = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${API_KEY}&kaptCode=${kaptCode.trim()}&_type=json`;
          const r = await fetch(infoUrl);
          const j = await r.json();
          const item = j?.response?.body?.item;
          if (!item) return null;
          return {
            kaptCode: kaptCode.trim(),
            kaptName: item.kaptName || '',
            addr: item.doroJuso || item.kaptAddr || '',
            built: item.kaptUsedate ? item.kaptUsedate.substring(0, 4) + '년' : '',
            units: item.kaptdaCnt ? item.kaptdaCnt + '세대' : '',
          };
        } catch (e) {
          return null;
        }
      })
    );
    return res.status(200).json(results.filter(Boolean));
  } else {
    return res.status(400).json({ error: 'type 파라미터가 필요합니다' });
  }

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
