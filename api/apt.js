export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const PUBLIC_API_KEY = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';

  const { type, code } = req.query;

  try {
    // Supabase DB에서 데이터 조회
    if (type === 'sido') {
      // 시도별 세대수 집계 - limit 높여서 전체 가져오기
      let all = [];
      let offset = 0;
      const limit = 1000;
      while(true) {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/apartments?select=sido,units&sido=not.is.null&limit=${limit}&offset=${offset}`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Range-Unit': 'items' } }
        );
        const data = await r.json();
        if (!Array.isArray(data) || data.length === 0) break;
        all = all.concat(data);
        if (data.length < limit) break;
        offset += limit;
      }
      const groups = {};
      all.forEach(d => {
        if (!d.sido) return;
        if (!groups[d.sido]) groups[d.sido] = { name: d.sido, units: 0, count: 0 };
        groups[d.sido].units += (d.units || 0);
        groups[d.sido].count++;
      });
      return res.status(200).json(Object.values(groups));

    } else if (type === 'sigungu') {
      // 시군구별 집계
      const sidoFilter = code ? `&sido=eq.${encodeURIComponent(code)}` : '';
      let data = [];
      let offset2 = 0;
      while(true) {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/apartments?select=sido,sigungu,units,lat,lng${sidoFilter}&limit=1000&offset=${offset2}`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        const chunk = await r.json();
        if (!Array.isArray(chunk) || chunk.length === 0) break;
        data = data.concat(chunk);
        if (chunk.length < 1000) break;
        offset2 += 1000;
      }
      const groups = {};
      data.forEach(d => {
        if (!d.sigungu) return;
        const key = `${d.sido}_${d.sigungu}`;
        if (!groups[key]) groups[key] = { name: d.sigungu, sido: d.sido, units: 0, count: 0, lats: [], lngs: [] };
        groups[key].units += (d.units || 0);
        groups[key].count++;
        if (d.lat) groups[key].lats.push(d.lat);
        if (d.lng) groups[key].lngs.push(d.lng);
      });
      return res.status(200).json(Object.values(groups).map(g => ({
        name: g.name, sido: g.sido, units: g.units, count: g.count,
        lat: g.lats.length ? g.lats.reduce((a,b)=>a+b,0)/g.lats.length : null,
        lng: g.lngs.length ? g.lngs.reduce((a,b)=>a+b,0)/g.lngs.length : null,
      })));

    } else if (type === 'dong') {
      // 읍면동별 집계
      const sigunguFilter = code ? `&sigungu=eq.${encodeURIComponent(code)}` : '';
      let data = [];
      let offset3 = 0;
      while(true) {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/apartments?select=sido,sigungu,dong,units,lat,lng${sigunguFilter}&dong=not.is.null&limit=1000&offset=${offset3}`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        const chunk = await r.json();
        if (!Array.isArray(chunk) || chunk.length === 0) break;
        data = data.concat(chunk);
        if (chunk.length < 1000) break;
        offset3 += 1000;
      }
      const groups = {};
      data.forEach(d => {
        if (!d.dong) return;
        const key = `${d.sido}_${d.sigungu}_${d.dong}`;
        if (!groups[key]) groups[key] = { name: d.dong, sigungu: d.sigungu, sido: d.sido, units: 0, count: 0, lats: [], lngs: [] };
        groups[key].units += (d.units || 0);
        groups[key].count++;
        if (d.lat) groups[key].lats.push(d.lat);
        if (d.lng) groups[key].lngs.push(d.lng);
      });
      return res.status(200).json(Object.values(groups).map(g => ({
        name: g.name, sigungu: g.sigungu, sido: g.sido, units: g.units, count: g.count,
        lat: g.lats.length ? g.lats.reduce((a,b)=>a+b,0)/g.lats.length : null,
        lng: g.lngs.length ? g.lngs.reduce((a,b)=>a+b,0)/g.lngs.length : null,
      })));

    } else if (type === 'apt') {
      // 단지 목록 (시군구 코드로 필터)
      const filter = code ? `&sigungu=eq.${encodeURIComponent(code)}` : '';
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/apartments?select=kapt_code,name,addr,lat,lng,units,built_year,type${filter}&limit=500`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const data = await r.json();
      return res.status(200).json(data);

    } else if (type === 'list') {
      // 기존 호환성 유지 - 공공데이터 API
      const sidoCode = code.substring(0, 2) + '00';
      const url = `https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3?serviceKey=${PUBLIC_API_KEY}&sidoCode=${sidoCode}&sigunguCode=${code}&numOfRows=1000&pageNo=1&_type=json`;
      const response = await fetch(url);
      const jsonData = await response.json();
      return res.status(200).json(jsonData);

    } else if (type === 'detail') {
      // 단지 상세정보 - Supabase 캐시 우선, 없으면 API 호출 후 저장
      if (!code) return res.status(400).json({ error: 'code 필요' });

      // 1. Supabase 캐시 확인
      const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/apartments?kapt_code=eq.${code}&select=far,bcr,heat_name,use_date,sale_name&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const cacheData = await cacheRes.json();
      const cached = Array.isArray(cacheData) && cacheData[0];
      // far/bcr 둘 다 있을 때만 캐시 사용 (null이면 건축물대장 API 재시도)
      if (cached && cached.far && cached.bcr) {
        return res.status(200).json({
          far: cached.far,
          bcr: cached.bcr,
          heatType: cached.heat_name || null,
          completionYmd: cached.use_date || null,
          saleType: cached.sale_name || null,
        });
      }

      // 2. V4 API 호출
      const KEY = encodeURIComponent(PUBLIC_API_KEY);
      const detailUrl = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${code}&_type=json`;
      const detailRes = await fetch(detailUrl);
      const detailText = await detailRes.text();
      let item = null;
      try {
        const detailData = JSON.parse(detailText);
        item = detailData?.response?.body?.item;
      } catch(e) {}
      if (!item) return res.status(404).json({ error: '데이터 없음', raw: detailText.substring(0, 300) });

      const result = {
        far: null,
        bcr: null,
        heatType: item.codeHeatNm || null,
        completionYmd: item.kaptUsedate || null,
        saleType: item.codeSaleNm || null,
      };

      // 3. 건축물대장 표제부(getBrTitleInfo) API로 용적률/건폐율 조회
      // V4 API에 kaptFar/kaptBcr 없음 → 건축물대장에서 vlRat/bcRat 사용
      const bjdCode = item.bjdCode || '';
      const kaptAddr = item.kaptAddr || '';
      if (bjdCode.length >= 10 && kaptAddr) {
        try {
          const sigunguCd = bjdCode.substring(0, 5);
          const bjdongCd = bjdCode.substring(5, 10);
          // kaptAddr 예: "서울특별시 강남구 역삼동 707-18 단지명"
          // 동/읍/면/리/가 다음에 오는 번지 파싱
          const addrMatch = kaptAddr.match(/[동읍면리가]\s+(\d+)-?(\d*)/);
          if (addrMatch) {
            const bun = addrMatch[1].padStart(4, '0');
            const ji = (addrMatch[2] || '0').padStart(4, '0');
            const bldUrl = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&_type=json&numOfRows=1`;
            const bldCtrl = new AbortController();
            const bldTimer = setTimeout(() => bldCtrl.abort(), 5000);
            const bldRes = await fetch(bldUrl, { signal: bldCtrl.signal });
            clearTimeout(bldTimer);
            const bldData = JSON.parse(await bldRes.text());
            const bldItem = bldData?.response?.body?.items?.item;
            const bldOne = Array.isArray(bldItem) ? bldItem[0] : bldItem;
            if (bldOne) {
              if (bldOne.vlRat) result.far = String(bldOne.vlRat);
              if (bldOne.bcRat) result.bcr = String(bldOne.bcRat);
            }
          }
        } catch(e) {}
      }

      // 4. Supabase에 저장 (비동기, 실패해도 응답은 정상 반환)
      fetch(
        `${SUPABASE_URL}/rest/v1/apartments?kapt_code=eq.${code}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            far: result.far,
            bcr: result.bcr,
            heat_name: result.heatType,
            use_date: result.completionYmd,
            sale_name: result.saleType,
          }),
        }
      ).catch(() => {});

      return res.status(200).json(result);

    } else {
      return res.status(400).json({ error: 'type 파라미터가 필요합니다' });
    }

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
