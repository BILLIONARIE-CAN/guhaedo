// api/land.js - 토지특성정보 조회 (공공데이터 프록시)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { pnu } = req.query;
  if (!pnu) return res.status(400).json({ error: 'pnu 필요' });
  const KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');
  const url = `https://apis.data.go.kr/1611000/nsdi/EnsLandCharacterService/attr/getLandCharacterStiInfo?serviceKey=${KEY}&pnu=${pnu}&numOfRows=1&pageNo=1&format=json`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
