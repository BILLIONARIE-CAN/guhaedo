export default async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type, code } = req.query;
  const API_KEY = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';

  let url = '';

  if (type === 'list') {
    // 시군구 단지 목록
    const sidoCode = code.substring(0, 2) + '00';
    url = `https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3?serviceKey=${API_KEY}&sidoCode=${sidoCode}&sigunguCode=${code}&numOfRows=1000&pageNo=1&_type=json`;
  } else if (type === 'info') {
    // 단지 기본정보
    url = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${API_KEY}&kaptCode=${code}&_type=json`;
  } else {
    return res.status(400).json({ error: 'type 파라미터가 필요합니다 (list 또는 info)' });
  }

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
