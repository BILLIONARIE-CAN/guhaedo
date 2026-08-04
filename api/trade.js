// 실거래가 조회 - /api/trade?code=KAPT_CODE (매칭 v2: 주소 우선)
// 단일 월 스트리밍: ?code=XXX&ym=YYYYMM
// Supabase 캐시: 2개월 이상 지난 월은 영구, 최근 2개월은 24h TTL

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function supaHeaders() {
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
}

// 캐시 조회
async function getCached(code, ym) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/apt_transactions?kapt_code=eq.${encodeURIComponent(code)}&ym=eq.${ym}&select=buy,jeonse,monthly,lawd_cd,apt_name,fetched_at`,
      { headers: supaHeaders(), signal: AbortSignal.timeout(2500) }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows[0]) return null;
    const row = rows[0];
    // 필터 로직 v2(주소 우선 매칭) 이전에 저장된 캐시는 전부 무효 (잘못된 0건 박제 방지)
    if (new Date(row.fetched_at).getTime() < Date.parse('2026-06-14T07:00:00Z')) return null;
    // apt_name 컬럼에 "단지명|법정동|지번" 패킹돼 있음 (구버전은 단지명만)
    const packed = String(row.apt_name || '').split('|');
    row.apt_name_clean = packed[0] || '';
    row.legal_dong = packed[1] || '';
    row.jibun_full = packed[2] || '';
    // 거래취소(계약해제)가 뒤늦게 반영될 수 있어 3단계 TTL:
    //  최근 2개월=24h, 2~7개월=7일(취소 반영), 7개월+=영구
    const ymDate = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(4,6))-1, 1);
    const cutPerm = new Date(); cutPerm.setMonth(cutPerm.getMonth()-7);
    const cutRecent = new Date(); cutRecent.setMonth(cutRecent.getMonth()-2);
    const age = Date.now() - new Date(row.fetched_at).getTime();
    if (ymDate < cutPerm) return row;                               // 7개월+ : 영구
    if (ymDate < cutRecent) return age < 7*86400000 ? row : null;    // 2~7개월 : 7일 TTL
    return age < 86400000 ? row : null;                             // 최근 2개월 : 24시간 TTL
  } catch { return null; }
}

// 배치 캐시 조회: 여러 월을 Supabase 쿼리 1번으로 (속도 핵심)
async function getCachedBatch(code, months) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !months.length) return {};
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/apt_transactions?kapt_code=eq.${encodeURIComponent(code)}&ym=in.(${months.join(',')})&select=ym,buy,jeonse,monthly,lawd_cd,apt_name,fetched_at`,
      { headers: supaHeaders(), signal: AbortSignal.timeout(3500) }
    );
    const rows = await r.json();
    const out = {};
    if (Array.isArray(rows)) {
      const cutPerm = new Date(); cutPerm.setMonth(cutPerm.getMonth() - 7);
      const cutRecent = new Date(); cutRecent.setMonth(cutRecent.getMonth() - 2);
      for (const row of rows) {
        if (new Date(row.fetched_at).getTime() < Date.parse('2026-06-14T07:00:00Z')) continue; // 구버전 무효
        const ymDate = new Date(parseInt(row.ym.slice(0,4)), parseInt(row.ym.slice(4,6)) - 1, 1);
        const age = Date.now() - new Date(row.fetched_at).getTime();
        let ok;
        if (ymDate < cutPerm) ok = true;                  // 7개월+ : 영구
        else if (ymDate < cutRecent) ok = age < 7*86400000; // 2~7개월 : 7일 TTL(취소 반영)
        else ok = age < 86400000;                         // 최근 2개월 : 24시간 TTL
        if (ok) out[row.ym] = row;
      }
    }
    return out;
  } catch { return {}; }
}

// 배치 캐시 저장 (여러 행 한 번에, fire-and-forget)
function setCachedBatch(rows) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !rows.length) return;
  fetch(`${SUPABASE_URL}/rest/v1/apt_transactions`, {
    method: 'POST',
    headers: { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(6000)
  }).catch(() => {});
}

async function pmapS(arr, fn, limit) {
  let i = 0; const ws = [];
  for (let w = 0; w < Math.min(limit, arr.length); w++) ws.push((async () => { while (i < arr.length) { const x = i++; await fn(arr[x]); } })());
  await Promise.all(ws);
}

// 캐시 저장 (fire-and-forget)
function setCached(code, ym, data) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/apt_transactions`, {
    method: 'POST',
    headers: { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      kapt_code: code, ym,
      buy: data.buy, jeonse: data.jeonse, monthly: data.monthly,
      lawd_cd: data.lawdCd, apt_name: data.aptName,
      fetched_at: new Date().toISOString()
    }),
    signal: AbortSignal.timeout(4000)
  }).catch(() => {});
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store'); // Supabase가 캐시 담당

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code 필요' });

  const ym = req.query.ym;

  // ── Supabase 캐시 히트 (단일 월 모드만) ──
  if (ym) {
    const cached = await getCached(code, ym);
    if (cached) {
      return res.status(200).json({
        aptName:   cached.apt_name_clean || '',
        lawdCd:    cached.lawd_cd  || '',
        legalDong: cached.legal_dong || '',
        jibunFull: cached.jibun_full || '',
        buy:       cached.buy      || [],
        jeonse:    cached.jeonse   || [],
        monthly:   cached.monthly  || [],
        fromCache: true
      });
    }
  }

  // ── 배치 모드 (?yms=202501,202502,...) : Supabase 쿼리 1번으로 캐시 일괄 조회 ──
  const ymsParam = req.query.yms ? String(req.query.yms).split(',').filter(m => /^\d{6}$/.test(m)).slice(0, 60) : null;
  let batchCached = null, batchMissing = null;
  if (ymsParam && ymsParam.length) {
    batchCached = await getCachedBatch(code, ymsParam);
    batchMissing = ymsParam.filter(m => !batchCached[m]);
    // 🔧 자가치유: 매칭 개선 이전에 '0건'으로 박제된 단지는 딱 한 번 재조회해서 채움.
    //    (재조회하면 fetched_at 갱신 → 다음부턴 재반복 안 함. 진짜 거래 없는 단지도 1회만 확인 후 통과.)
    if (!batchMissing.length) {
      let tot = 0, oldest = Infinity;
      for (const m of ymsParam) {
        const r2 = batchCached[m];
        tot += (r2.buy ? r2.buy.length : 0) + (r2.jeonse ? r2.jeonse.length : 0) + (r2.monthly ? r2.monthly.length : 0);
        const ft = Date.parse(r2.fetched_at || 0); if (ft < oldest) oldest = ft;
      }
      if (tot === 0 && oldest < Date.parse('2026-08-04T12:00:00Z')) batchMissing = ymsParam.slice();
    }
    // 전부 캐시 → V4/국토부 호출 0회, 즉시 응답 (아실급 속도)
    if (!batchMissing.length) {
      const first = batchCached[ymsParam[0]];
      const packed = String(first.apt_name || '').split('|');
      const buy = [], jeonse = [], monthly = [];
      for (const m of ymsParam) {
        const r2 = batchCached[m];
        (r2.buy || []).forEach(x => buy.push(x));
        (r2.jeonse || []).forEach(x => jeonse.push(x));
        (r2.monthly || []).forEach(x => monthly.push(x));
      }
      return res.status(200).json({
        aptName: packed[0] || '', lawdCd: first.lawd_cd || '',
        legalDong: packed[1] || '', jibunFull: packed[2] || '',
        buy, jeonse, monthly, missing: [], fromCache: true
      });
    }
  }

  const KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');

  // lawdCd / aptName 결정
  let lawdCd = req.query.lawdCd || '';
  let aptName = req.query.aptName ? decodeURIComponent(req.query.aptName) : '';
  let aptLegalDong = req.query.legalDong ? decodeURIComponent(req.query.legalDong) : '';
  let aptJibunNum  = parseInt(req.query.jibunNum || '0') || 0;
  let aptJibunFull = req.query.jibunFull ? decodeURIComponent(req.query.jibunFull) : '';

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

      // 법정동명 + 지번 추출 (kaptAddr: "충남 아산시 배방읍 장재리 123-4")
      // 읍/면 아래 리까지 전부 수집 — 국토부 umdNm이 "배방읍"일 수도 "장재리"일 수도 있음
      const kaptAddr = (item.kaptAddr || '').trim();
      if (kaptAddr) {
        const parts = kaptAddr.replace(/\s+/g, ' ').split(' ');
        let passedGungu = false;
        const dongs = [];
        for (const p of parts) {
          if (/^산?\d+(-\d+)?(번지)?$/.test(p)) { aptJibunFull = p.replace(/번지$/, ''); break; }
          if (!passedGungu) { if (/[시군구]$/.test(p)) passedGungu = true; continue; }
          if (/[동읍면리가]$/.test(p)) dongs.push(p);
        }
        if (dongs.length) aptLegalDong = dongs.join(' ');
        if (aptJibunFull) aptJibunNum = parseInt(aptJibunFull.replace(/^산/, '').split('-')[0]) || 0;
      }
    }
  }

  // 조회 월 목록
  let months = [];
  if (ym) {
    months = [ym];
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

  // 준공년도 (프론트에서 전달 → 건축년도 크로스체크용)
  const builtYear = parseInt(req.query.builtYear || '0') || 0;

  // 지번 소스 우선순위: kaptAddr 파싱 > jibunFull 파라미터 > jibunNum 파라미터 > 핀 데이터(jibun)
  if (!aptJibunFull && aptJibunNum) aptJibunFull = String(aptJibunNum);
  if (!aptJibunFull && /^\d/.test(String(req.query.jibun || ''))) aptJibunFull = String(req.query.jibun).trim();

  function parseJibun(s) {
    const m = String(s || '').trim().match(/^산?(\d+)(?:-(\d+))?/);
    return m ? { bon: parseInt(m[1]), bu: m[2] != null ? parseInt(m[2]) : null } : null;
  }
  const myJibun = parseJibun(aptJibunFull);
  const myDongPart = aptLegalDong.replace(/\s/g, ''); // "배방읍장재리"

  const normalize = s => {
    let t = String(s || '').trim().replace(/[\s()（）·\-\/]/g, '').toUpperCase();
    for (let i = 0; i < 2; i++) t = t.replace(/(아파트|APT|맨션|관리사무소|관리동)$/, '');
    return t;
  };
  const myName = normalize(aptName);

  // 지번 완전 호환 (본번 일치 + 부번은 양쪽 다 있을 때만 비교)
  function jbCompat(a, b) {
    return !!(a && b && a.bon === b.bon && (a.bu == null || b.bu == null || a.bu === b.bu));
  }

  // 건축년도 ±1년 (필드 없으면 통과)
  function buildYearMatch(x) {
    if (!builtYear) return true;
    const by = parseInt(x.buildYear || '0');
    if (!by) return true;
    return by >= builtYear - 1 && by <= builtYear + 1;
  }

  // 법정동: umdNm("배방읍"/"장재리"/"배방읍 장재리")이 주소 동·읍·면·리 부분과 겹치면 OK
  function dongMatch(x) {
    if (!myDongPart) return true;
    const xd = (x.umdNm || '').replace(/\s/g, '');
    if (!xd) return true;
    return myDongPart.includes(xd) || xd.includes(myDongPart);
  }

  // ① 주소 일치 = 법정동 + 지번 본번 (부번은 양쪽 다 있을 때만 비교)
  //    같은 동, 같은 필지면 같은 단지 → 단지명 표기가 달라도 매칭
  function addrMatch(x) {
    if (!myJibun || !myDongPart) return false;
    const xj = parseJibun(x.jibun);
    if (!xj || xj.bon !== myJibun.bon) return false;
    if (myJibun.bu != null && xj.bu != null && xj.bu !== myJibun.bu) return false;
    return dongMatch(x);
  }

  // ② 이름 매칭 경로용 지번 soft 체크 (정보 있으면 본번 일치해야)
  function jibunSoft(x) {
    if (!myJibun) return true;
    const xj = parseJibun(x.jibun);
    return !xj || xj.bon === myJibun.bon;
  }

  function aptMatch(x) {
    if ((x.cdealType || '').trim()) return false; // 계약 해제 제외
    if (!buildYearMatch(x)) return false;
    if (addrMatch(x)) return true;                // ① 주소(법정동+지번) 일치 → 단지명 무시
    const n = normalize(x.aptNm);
    if (!n || !myName) return false;
    const xj = parseJibun(x.jibun);
    // ② 단지명 완전일치
    if (n === myName) {
      if (dongMatch(x)) return myDongPart ? true : jibunSoft(x); // 동 일치 → 지번 무시 (모지번/합필 대응)
      // 동 불일치 → 본번+부번까지 완전일치일 때만 인정 (법정동 개편 대응)
      // 부번 없는 지번은 다른 동의 같은 본번과 충돌 위험이 있어 제외
      return !!(xj && myJibun && xj.bon === myJibun.bon && xj.bu != null && myJibun.bu != null && xj.bu === myJibun.bu);
    }
    // ②-b 국토부명이 "기본명(브랜드/별칭)" 형태 → 괄호 떼면 우리 이름과 정확일치 + 같은 법정동이면 동일단지.
    //     (K-apt 대표지번 vs 국토부 실거래 지번이 달라도 인정 — 신도시 다필지 단지 대응. 예: 새샘마을3단지(모아미래도리버시티))
    const nBase = normalize(String(x.aptNm || '').replace(/\([^)]*\)/g, ''));
    if (nBase && nBase === myName && dongMatch(x)) return true;
    // ③ 부분포함 (지역명·브랜드 접두/접미 차이)
    if (!dongMatch(x)) return false;
    const L = Math.min(n.length, myName.length);
    if (L < 4) return false;
    if (!(n.includes(myName) || myName.includes(n))) return false;
    const big = n.length >= myName.length ? n : myName;
    const small = big === n ? myName : n;
    const extra = big.replace(small, '');
    const bonOk = jbCompat(xj, myJibun);
    // 5자 이상: 지번 일치 OR 추가 글자가 숫자 없는 짧은 지역명(≤4자) — "전주"+"태평아이파크" 등
    //          차수/단지 숫자가 들어가면(2차, 3단지...) 지번 검증 필수 → 동명 1·2차 혼입 방지
    if (L >= 5) return bonOk || (!/\d/.test(extra) && extra.length <= 4);
    // ④ 4자 이름(황등오투, 동신진주 등)은 generic 위험 → 지번 완전일치일 때만
    return bonOk;
  }

  const buyBase  = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
  const rentBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
  const preBase  = 'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade'; // 분양권/입주권 전매

  // ── 배치 모드: 캐시 미보유 월만 최대 12개 페치, 나머지는 missing으로 반환 (프론트가 이어서 요청) ──
  if (ymsParam && ymsParam.length) {
    const toFetch = batchMissing.slice(0, 12);
    const rest = batchMissing.slice(12);
    const fetched = {};
    const candPool = [];
    const mapT = x => `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth)||1).padStart(2,'0')}`;

    await pmapS(toFetch, async m => {
      // 분양권(pre) 실패는 매매/전월세 캐싱을 막지 않도록 분리 (errCore만 캐시 차단)
      let errCore = false, errPre = false;
      const safeJ = (u, isPre) => fetch(u, { signal: AbortSignal.timeout(isPre ? 3000 : 5000) })
        .then(r => r.json())
        .then(j => { const c = j?.response?.header?.resultCode; if (c && c !== '00' && c !== '000') { if (isPre) errPre = true; else errCore = true; return []; } return parseItems(j); })
        .catch(() => { if (isPre) errPre = true; else errCore = true; return []; });
      const wantPre = !builtYear || parseInt(m.slice(0, 4)) <= builtYear + 1;
      const [bRaw, rRaw, pRaw] = await Promise.all([
        safeJ(`${buyBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${m}&numOfRows=1000&_type=json`, false),
        safeJ(`${rentBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${m}&numOfRows=1000&_type=json`, false),
        wantPre ? safeJ(`${preBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${m}&numOfRows=1000&_type=json`, true) : Promise.resolve([])
      ]);
      const mBuy = bRaw.filter(x => aptMatch(x)).map(x => ({
        t: mapT(x), day: String(x.dealDay||'').trim(), p: parsePrice(x.dealAmount),
        a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
      }));
      pRaw.filter(x => aptMatch(x)).forEach(x => {
        mBuy.push({ t: mapT(x), day: String(x.dealDay||'').trim(), p: parsePrice(x.dealAmount),
          a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim(),
          pre: String(x.ownershipGbn||'').trim().startsWith('입') ? '입' : '분' });
      });
      const rents = rRaw.filter(x => aptMatch(x));
      fetched[m] = {
        buy: mBuy,
        jeonse: rents.filter(x => !parsePrice(x.monthlyRent)).map(x => ({
          t: mapT(x), day: String(x.dealDay||'').trim(), p: parsePrice(x.deposit),
          a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
        })),
        monthly: rents.filter(x => parsePrice(x.monthlyRent) > 0).map(x => ({
          t: mapT(x), day: String(x.dealDay||'').trim(), d: parsePrice(x.deposit),
          m: parsePrice(x.monthlyRent), a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
        })),
        _err: errCore
      };
      if (candPool.length < 3000) candPool.push(...bRaw, ...rRaw, ...pRaw);
    }, 12);  // 동시처리 12 = 미보유 월 1웨이브에 처리 (분양권 지연 누적으로 인한 함수 시간초과 방지)

    // 캐시 업서트 (오류 월 제외 — 빈 데이터 박제 방지)
    setCachedBatch(toFetch.filter(m => fetched[m] && !fetched[m]._err).map(m => ({
      kapt_code: code, ym: m,
      buy: fetched[m].buy, jeonse: fetched[m].jeonse, monthly: fetched[m].monthly,
      lawd_cd: lawdCd, apt_name: [aptName, aptLegalDong, aptJibunFull].join('|'),
      fetched_at: new Date().toISOString()
    })));

    // 캐시분 + 페치분 조립
    const buy = [], jeonse = [], monthly = [];
    for (const m of ymsParam) {
      const src = batchCached[m] || fetched[m];
      if (!src) continue;
      (src.buy || []).forEach(x => buy.push(x));
      (src.jeonse || []).forEach(x => jeonse.push(x));
      (src.monthly || []).forEach(x => monthly.push(x));
    }

    // 전부 0건이면 같은 동네 국토부 등록명 후보 (진단용)
    let candidates;
    if (!buy.length && !jeonse.length && !monthly.length && candPool.length) {
      const inDong = candPool.filter(x => dongMatch(x) && !(x.cdealType || '').trim());
      const seen = new Set(); candidates = [];
      for (const x of (inDong.length ? inDong : candPool)) {
        const nm = (x.aptNm || '').trim();
        if (nm && !seen.has(nm)) { seen.add(nm); candidates.push(nm + (x.jibun ? '(' + String(x.jibun).trim() + ')' : '')); }
        if (candidates.length >= 8) break;
      }
    }

    return res.status(200).json({
      aptName, lawdCd, legalDong: aptLegalDong, jibunFull: aptJibunFull,
      buy, jeonse, monthly, missing: rest,
      ...(candidates && candidates.length ? { candidates } : {})
    });
  }

  const [buyRaw, rentRaw, preRaw] = await Promise.all([
    Promise.all(months.map(m =>
      fetch(`${buyBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${m}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    )),
    Promise.all(months.map(m =>
      fetch(`${rentBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${m}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.json()).then(parseItems).catch(() => [])
    )),
    // 분양권은 준공+1년 이후엔 거래 없음 → 해당 월만 호출 (builtYear 모르면 전부 호출)
    Promise.all(months.map(m => {
      if (builtYear && parseInt(m.slice(0, 4)) > builtYear + 1) return Promise.resolve([]);
      return fetch(`${preBase}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${m}&numOfRows=1000&_type=json`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.json()).then(parseItems).catch(() => []);
    }))
  ]);

  const buy = buyRaw.flat().filter(x => aptMatch(x)).map(x => ({
    t: `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth)||1).padStart(2,'0')}`,
    day: String(x.dealDay||'').trim(), p: parsePrice(x.dealAmount),
    a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
  }));

  // 분양권/입주권 전매 → 매매 시리즈에 병합 (pre: '분'|'입' 플래그로 구분)
  // 분양권 데이터엔 buildYear 없음 → buildYearMatch 자동 통과, 주소 매칭으로 식별
  preRaw.flat().filter(x => aptMatch(x)).forEach(x => {
    buy.push({
      t: `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth)||1).padStart(2,'0')}`,
      day: String(x.dealDay||'').trim(), p: parsePrice(x.dealAmount),
      a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim(),
      pre: String(x.ownershipGbn||'').trim().startsWith('입') ? '입' : '분'
    });
  });

  const allRent = rentRaw.flat().filter(x => aptMatch(x));

  const jeonse = allRent.filter(x => !parsePrice(x.monthlyRent)).map(x => ({
    t: `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth)||1).padStart(2,'0')}`,
    day: String(x.dealDay||'').trim(), p: parsePrice(x.deposit),
    a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
  }));

  const monthly = allRent.filter(x => parsePrice(x.monthlyRent) > 0).map(x => ({
    t: `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth)||1).padStart(2,'0')}`,
    day: String(x.dealDay||'').trim(), d: parsePrice(x.deposit),
    m: parsePrice(x.monthlyRent), a: parseFloat(x.excluUseAr||0), f: String(x.floor||'').trim()
  }));

  // 매칭 0건 진단: 같은 법정동에 국토부가 등록해둔 단지명 후보 반환
  let candidates;
  if (!buy.length && !jeonse.length && !monthly.length) {
    const pool = [...buyRaw.flat(), ...rentRaw.flat(), ...preRaw.flat()];
    const inDong = pool.filter(x => dongMatch(x) && !(x.cdealType || '').trim());
    const seen = new Set();
    candidates = [];
    for (const x of (inDong.length ? inDong : pool)) {
      const nm = (x.aptNm || '').trim();
      if (nm && !seen.has(nm)) {
        seen.add(nm);
        candidates.push(nm + (x.jibun ? '(' + String(x.jibun).trim() + ')' : ''));
      }
      if (candidates.length >= 8) break;
    }
  }

  // 캐시 저장 (응답 블로킹 없음) — apt_name 컬럼에 법정동/지번 패킹
  if (ym) setCached(code, ym, { buy, jeonse, monthly, lawdCd, aptName: [aptName, aptLegalDong, aptJibunFull].join('|') });

  return res.status(200).json({
    aptName, lawdCd, legalDong: aptLegalDong, jibunNum: aptJibunNum, jibunFull: aptJibunFull,
    buy, jeonse, monthly,
    ...(candidates && candidates.length ? { candidates } : {})
  });
}
