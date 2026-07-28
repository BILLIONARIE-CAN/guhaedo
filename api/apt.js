// ===== 공용관리비 온디맨드 (원래 api/mgmtcost.js — Hobby 12함수 한도 때문에 apt.js에 통합) =====
//   /api/apt?type=mgmtcost&code=KAPT_CODE&units=세대수
const MGMT_KEY  = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';
const MGMT_BASE = 'https://apis.data.go.kr/1613000/AptCmnuseManageCostServiceV2';
const MGMT_OPS = [
  ['getHsmpLaborCostInfoV2',              '인건비'],
  ['getHsmpOfcrkCostInfoV2',              '제사무비'],
  ['getHsmpTaxdueInfoV2',                 '제세공과금'],
  ['getHsmpClothingCostInfoV2',           '피복비'],
  ['getHsmpEduTraingCostInfoV2',          '교육훈련비'],
  ['getHsmpVhcleMntncCostInfoV2',         '차량유지비'],
  ['getHsmpEtcCostInfoV2',                '그밖의 부대비용'],
  ['getHsmpCleaningCostInfoV2',           '청소비'],
  ['getHsmpGuardCostInfoV2',              '경비비'],
  ['getHsmpDisinfectionCostInfoV2',       '소독비'],
  ['getHsmpElevatorMntncCostInfoV2',      '승강기 유지비'],
  ['getHsmpHomeNetworkMntncCostInfoV2',   '홈네트워크 유지비'],
  ['getHsmpRepairsCostInfoV2',            '수선비'],
  ['getHsmpFacilityMntncCostInfoV2',      '시설유지비'],
  ['getHsmpSafetyCheckUpCostInfoV2',      '안전점검비'],
  ['getHsmpDisasterPreventionCostInfoV2', '재해예방비'],
  ['getHsmpConsignManageFeeInfoV2',       '위탁관리 수수료'],
];
function mgmtHeaders() {
  const k = process.env.SUPABASE_KEY;
  return { 'apikey': k, 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' };
}
async function mgmtReadCache(code) {
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
  if (!U || !K) return null;
  try {
    const r = await fetch(`${U}/rest/v1/apt_mgmtcost?kapt_code=eq.${encodeURIComponent(code)}&select=ym,total,per_hshld,detail,fetched_at`, { headers: mgmtHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const row = rows[0];
    if (Date.now() - new Date(row.fetched_at).getTime() > 30 * 86400000) return null;
    return row;
  } catch (e) { return null; }
}
function mgmtWriteCache(code, ym, total, per, detail) {
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_KEY;
  if (!U || !K) return;
  fetch(`${U}/rest/v1/apt_mgmtcost`, {
    method: 'POST',
    headers: { ...mgmtHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify([{ kapt_code: code, ym, total, per_hshld: per, detail, fetched_at: new Date().toISOString() }]),
  }).catch(() => {});
}
function mgmtSumItem(item) {
  if (!item) return 0;
  const arr = Array.isArray(item) ? item : [item];
  let s = 0;
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    for (const k in it) {
      if (k === 'kaptCode' || k === 'kaptName') continue;
      const v = Number(it[k]);
      if (!isNaN(v)) s += v;
    }
  }
  return s;
}
async function mgmtFetchOp(op, code, ym) {
  try {
    const r = await fetch(`${MGMT_BASE}/${op}?serviceKey=${encodeURIComponent(MGMT_KEY)}&kaptCode=${code}&searchDate=${ym}&_type=json`, { signal: AbortSignal.timeout(6000) });
    const j = JSON.parse(await r.text());
    return mgmtSumItem(j && j.response && j.response.body && j.response.body.item);
  } catch (e) { return 0; }
}
async function mgmtFindYm(code) {
  const now = new Date();
  for (let back = 2; back <= 13; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (await mgmtFetchOp('getHsmpCleaningCostInfoV2', code, ym) > 0) return ym;
  }
  return null;
}
async function handleMgmtCost(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const code = req.query.code;
  const units = parseInt(req.query.units) || 0;
  if (!code) return res.status(400).json({ error: 'code 필요' });
  const cached = await mgmtReadCache(code);
  if (cached) return res.status(200).json({ cached: true, ym: cached.ym, total: cached.total, perHousehold: cached.per_hshld, detail: cached.detail || [], units, empty: !cached.total });
  const ym = await mgmtFindYm(code);
  if (!ym) { mgmtWriteCache(code, '', 0, 0, []); return res.status(200).json({ ym: null, total: 0, perHousehold: 0, detail: [], units, empty: true }); }
  const results = await Promise.all(MGMT_OPS.map(async ([op, label]) => ({ label, amount: await mgmtFetchOp(op, code, ym) })));
  const total = results.reduce((s, x) => s + x.amount, 0);
  const detail = results.filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
  const per = units > 0 ? Math.round(total / units) : 0;
  mgmtWriteCache(code, ym, total, per, detail);
  return res.status(200).json({ cached: false, ym, total, perHousehold: per, detail, units, empty: total === 0 });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const PUBLIC_API_KEY = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';

  const { type, code } = req.query;

  if (type === 'mgmtcost') return handleMgmtCost(req, res);

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

      // 3. 건축물대장 API로 용적률/건폐율 조회
      // 우선 표제부(getBrTitleInfo, 동별), 없으면 총괄표제부(getBrRecapTitleInfo, 단지 전체) 순으로 시도
      const bjdCode = item.bjdCode || '';
      const kaptAddr = item.kaptAddr || '';
      if (bjdCode.length >= 10 && kaptAddr) {
        try {
          const sigunguCd = bjdCode.substring(0, 5);
          const bjdongCd = bjdCode.substring(5, 10);
          const addrMatch = kaptAddr.match(/[동읍면리가]\s+(\d+)-?(\d*)/);
          if (addrMatch) {
            const bun = addrMatch[1].padStart(4, '0');
            const ji = (addrMatch[2] || '0').padStart(4, '0');

            // 1차: 표제부 (getBrTitleInfo)
            // ⚠️ numOfRows=1이면 관리동 같은 부속건물이 첫 행일 때 용적률이 빈 값 →
            //    100행 받아서 용적률 있는 행 중 연면적 최대(주건축물) 선택
            const bldCtrl = new AbortController();
            const bldTimer = setTimeout(() => bldCtrl.abort(), 6000);
            const bldRes = await fetch(
              `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&_type=json&numOfRows=100`,
              { signal: bldCtrl.signal }
            );
            clearTimeout(bldTimer);
            const bldData = JSON.parse(await bldRes.text());
            const bldItem = bldData?.response?.body?.items?.item;
            const bldList = bldItem ? (Array.isArray(bldItem) ? bldItem : [bldItem]) : [];
            const withRat = bldList.filter(b => parseFloat(b.vlRat) > 0);
            const bldOne = withRat.sort((a, b) => (parseFloat(b.totArea) || 0) - (parseFloat(a.totArea) || 0))[0] || bldList[0];
            if (bldOne) {
              if (parseFloat(bldOne.vlRat) > 0) result.far = String(bldOne.vlRat);
              if (parseFloat(bldOne.bcRat) > 0) result.bcr = String(bldOne.bcRat);
            }

            // 2차: 총괄표제부 (getBrRecapTitleInfo) — 표제부에 값 없을 때 또는 주차 보완용
            if (!result.far || !result.bcr) {
              const recapCtrl = new AbortController();
              const recapTimer = setTimeout(() => recapCtrl.abort(), 5000);
              const recapRes = await fetch(
                `https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&_type=json&numOfRows=1`,
                { signal: recapCtrl.signal }
              );
              clearTimeout(recapTimer);
              const recapData = JSON.parse(await recapRes.text());
              const recapItem = recapData?.response?.body?.items?.item;
              const recapOne = Array.isArray(recapItem) ? recapItem[0] : recapItem;
              if (recapOne) {
                if (!result.far && recapOne.vlRat) result.far = String(recapOne.vlRat);
                if (!result.bcr && recapOne.bcRat) result.bcr = String(recapOne.bcRat);
                if (recapOne.totPkngCnt) result.totalPark = recapOne.totPkngCnt;
              }
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
            ...(result.totalPark != null ? { total_park: result.totalPark } : {}),
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
