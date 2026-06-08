// 용적률/건폐율 일괄 수집 - 한 번 쓰고 삭제할 엔드포인트
// 호출: /api/populate?secret=guh2024xK9mPq7&offset=0

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.query.secret !== process.env.POPULATE_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');
  const BATCH = 20;
  const offset = parseInt(req.query.offset) || 0;

  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apartments?select=kapt_code&or=(far.is.null,bcr.is.null)&limit=${BATCH}&offset=${offset}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const list = await listRes.json();
  if (!Array.isArray(list) || list.length === 0) {
    return res.status(200).json({ done: true, offset, processed: 0, far_count: 0 });
  }

  const results = await Promise.allSettled(list.map(async ({ kapt_code }) => {
    try {
      const v4Res = await fetch(
        `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kapt_code}&_type=json`,
        { signal: AbortSignal.timeout(7000) }
      );
      const item = (await v4Res.json())?.response?.body?.item;
      if (!item) return { far: null };

      let far = null, bcr = null;
      const bjdCode = item.bjdCode || '';
      const kaptAddr = item.kaptAddr || '';

      if (bjdCode.length >= 10 && kaptAddr) {
        const addrMatch = kaptAddr.match(/[동읍면리가]\s+(\d+)-?(\d*)/);
        if (addrMatch) {
          const bun = addrMatch[1].padStart(4, '0');
          const ji = (addrMatch[2] || '0').padStart(4, '0');
          const bldRes = await fetch(
            `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${KEY}&sigunguCd=${bjdCode.substring(0,5)}&bjdongCd=${bjdCode.substring(5,10)}&bun=${bun}&ji=${ji}&_type=json&numOfRows=1`,
            { signal: AbortSignal.timeout(7000) }
          );
          const bldOne = ((await bldRes.json())?.response?.body?.items?.item || [])[0];
          if (bldOne?.vlRat) far = String(bldOne.vlRat);
          if (bldOne?.bcRat) bcr = String(bldOne.bcRat);
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/apartments?kapt_code=eq.${kapt_code}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ far, bcr, heat_name: item.codeHeatNm||null, use_date: item.kaptUsedate||null, sale_name: item.codeSaleNm||null }),
      });
      return { far };
    } catch { return { far: null }; }
  }));

  const far_count = results.filter(r => r.value?.far).length;
  return res.status(200).json({
    done: list.length < BATCH,
    offset,
    next_offset: offset + list.length,
    processed: list.length,
    far_count,
  });
}
