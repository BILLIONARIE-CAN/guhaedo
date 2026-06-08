/**
 * 아파트 용적률/건폐율 일괄 수집 스크립트
 *
 * 사용법:
 *   1. 프로젝트 루트에 .env.local 파일 생성 후 아래 내용 입력:
 *      SUPABASE_URL=https://your-project.supabase.co
 *      SUPABASE_KEY=your-service-role-key
 *
 *   2. 실행: node scripts/populate.js
 */

const fs = require('fs');
const path = require('path');

// .env.local 파싱
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('.env.local 파일이 없습니다. 프로젝트 루트에 만들어주세요.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key) process.env[key] = val;
    }
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PUBLIC_API_KEY = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';
const CONCURRENCY = 5;  // 동시 처리 수
const DELAY_MS = 300;   // 배치 간 딜레이 (ms)

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL, SUPABASE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

async function fetchApartments() {
  let all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/apartments?select=kapt_code&or=(far.is.null,bcr.is.null)&limit=${limit}&offset=${offset}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data.map(d => d.kapt_code));
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

async function fetchFarBcr(kaptCode) {
  const KEY = encodeURIComponent(PUBLIC_API_KEY);

  // V4 API로 bjdCode, kaptAddr 조회
  const v4Res = await fetch(
    `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`,
    { signal: AbortSignal.timeout(8000) }
  );
  const v4Data = await v4Res.json();
  const item = v4Data?.response?.body?.item;
  if (!item) return null;

  const bjdCode = item.bjdCode || '';
  const kaptAddr = item.kaptAddr || '';
  let far = null;
  let bcr = null;

  // 건축물대장 표제부로 vlRat/bcRat 조회
  if (bjdCode.length >= 10 && kaptAddr) {
    const sigunguCd = bjdCode.substring(0, 5);
    const bjdongCd = bjdCode.substring(5, 10);
    const addrMatch = kaptAddr.match(/[동읍면리가]\s+(\d+)-?(\d*)/);
    if (addrMatch) {
      const bun = addrMatch[1].padStart(4, '0');
      const ji = (addrMatch[2] || '0').padStart(4, '0');
      const bldRes = await fetch(
        `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&_type=json&numOfRows=1`,
        { signal: AbortSignal.timeout(8000) }
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

  return {
    far,
    bcr,
    heat_name: item.codeHeatNm || null,
    use_date: item.kaptUsedate || null,
    sale_name: item.codeSaleNm || null,
  };
}

async function updateApartment(kaptCode, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/apartments?kapt_code=eq.${kaptCode}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('미완성 아파트 목록 조회 중...');
  const codes = await fetchApartments();
  console.log(`총 ${codes.length}개 처리 필요\n`);
  if (codes.length === 0) { console.log('모두 완성됨!'); return; }

  let done = 0;
  let farCount = 0;

  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (code) => {
        try {
          const data = await fetchFarBcr(code);
          if (data) await updateApartment(code, data);
          return data;
        } catch (e) {
          return null;
        }
      })
    );
    done += batch.length;
    const got = results.filter(r => r.value?.far).length;
    farCount += got;
    process.stdout.write(`\r[${done}/${codes.length}] 용적률 획득: ${farCount}개`);
    if (i + CONCURRENCY < codes.length) await sleep(DELAY_MS);
  }

  console.log(`\n\n완료! ${codes.length}개 중 ${farCount}개 용적률/건폐율 저장됨`);
}

main().catch(console.error);
