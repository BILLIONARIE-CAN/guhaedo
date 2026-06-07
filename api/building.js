// api/building.js
// 건축물대장 표제부 조회 (건축HUB API 프록시 - CORS 우회)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { sigunguCd, bjdongCd, bun, ji } = req.query;
  if (!sigunguCd || !bjdongCd || !bun) {
    return res.status(400).json({ error: '파라미터 부족' });
  }
  const KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${String(bun).padStart(4,'0')}&ji=${String(ji||0).padStart(4,'0')}&_type=json&numOfRows=10&pageNo=1`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
