// 용적률/건폐율 일괄 수집 엔드포인트
// 사용법: /api/populate?secret=guhaedo2024&offset=0
// 한 번에 20개씩 처리, offset으로 페이지네이션

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.query.secret !== 'guhaedo2024') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const PUBLIC_API_KEY = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';
  const KEY = encodeURIComponent(PUBLIC_API_KEY);
  const BATCH = 20;
  const offset = parseInt(req.query.offset) || 0;

  // far/bcr 없는 아파트 BATCH개 조회
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apartments?select=kapt_code&or=(far.is.null,bcr.is.null)&limit=${BATCH}&offset=${offset}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const list = await listRes.json();
  if (!Array.isArray(list) || list.length === 0) {
    return res.status(200).json({ done: true, offset, processed: 0 });
  }

  // 병렬 처리
  const results = await Promise.allSettled(list.map(async ({ kapt_code }) => {
    try {
      // V4 API
      const v4Res = await fetch(
        `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kapt_code}&_type=json`,
        { signal: AbortSignal.timeout(7000) }
      );
      const v4Data = await v4Res.json();
      const item = v4Data?.response?.body?.item;
      if (!item) return { code: kapt_code, ok: false };

      let far = null, bcr = null;
      const bjdCode = item.bjdCode || '';
      const kaptAddr = item.kaptAddr || '';

      if (bjdCode.length >= 10 && kaptAddr) {
        const sigunguCd = bjdCode.substring(0, 5);
        const bjdongCd = bjdCode.substring(5, 10);
        const addrMatch = kaptAddr.match(/[동읍면리가]\s+(\d+)-?(\d*)/);
        if (addrMatch) {
          const bun = addrMatch[1].padStart(4, '0');
          const ji = (addrMatch[2] || '0').padStart(4, '0');
          const bldRes = await fetch(
            `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&_type=json&numOfRows=1`,
            { signal: AbortSignal.timeout(7000) }
          );
          const bldData = await bldRes.json();
          const bldItem = bldData?.response?.body?.items?.item;
          const bldOne = Array.isArray(bldItem) ? bldItem[0] : bldItem;
          if (bldOne) {
            if (bldOne.vlRat) far = String(bldOne.vlRat);
            if (bldOne.bcRat) bcr = String(bldOne.bcRat);
          }
        }
      }

      // Supabase 저장
      await fetch(`${SUPABASE_URL}/rest/v1/apartments?kapt_code=eq.${kapt_code}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          far, bcr,
          heat_name: item.codeHeatNm || null,
          use_date: item.kaptUsedate || null,
          sale_name: item.codeSaleNm || null,
        }),
      });

      return { code: kapt_code, far, bcr, ok: true };
    } catch (e) {
      return { code: kapt_code, ok: false, error: e.message };
    }
  }));

  const got = results.filter(r => r.value?.far).length;
  return res.status(200).json({
    done: list.length < BATCH,
    offset,
    next_offset: offset + list.length,
    processed: list.length,
    far_count: got,
  });
}
