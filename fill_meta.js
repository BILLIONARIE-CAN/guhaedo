// 용적률/건폐율 일괄 수집 스크립트
// 실행: cd C:\Users\essoz\GitHub\guhaedo && node fill_meta.js
// 중간에 Ctrl+C로 꺼도 progress_meta.json에 저장되어 이어서 실행 가능
// 하루 한도(K-apt ~1만건) 고려해서 기본 9,000건 처리 후 자동 종료

import fs from 'fs';

const SUPABASE_URL = 'https://nqnbbccazjanjhktknyz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbmJiY2Nhemphbmpoa3Rrbnl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0OTA5NDQsImV4cCI6MjA5NTA2Njk0NH0.rT_hIwTJyBnCDGyudmJYvN44G67WgZ9-bSVCzShiRjI';
const API_KEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');
const PROGRESS_FILE = 'progress_meta.json';
const DAILY_LIMIT = 9000; // 하루 처리 한도 (K-apt 1만건 여유분 포함)

const supaHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 진행상황 불러오기
function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return { done: [], failed: [] };
  }
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Supabase에서 far/bcr 없는 단지 목록 가져오기
async function getMissingList() {
  let all = [], offset = 0;
  while (true) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/apartments?select=kapt_code,name&or=(far.is.null,bcr.is.null)&limit=1000&offset=${offset}`,
      { headers: supaHeaders }
    );
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return all;
}

// K-apt V4 API로 bjdCode, kaptAddr 가져오기
async function getV4Info(kaptCode) {
  const url = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${API_KEY}&kaptCode=${kaptCode}&_type=json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  const item = j?.response?.body?.item;
  if (!item) return null;
  return {
    bjdCode: item.bjdCode || '',
    kaptAddr: item.kaptAddr || '',
    heatType: item.codeHeatNm || null,
    completionYmd: item.kaptUsedate || null,
    saleType: item.codeSaleNm || null,
  };
}

// 건축물대장 API로 용적률/건폐율 가져오기
async function getBldInfo(bjdCode, kaptAddr) {
  if (!bjdCode || bjdCode.length < 10 || !kaptAddr) return null;
  const sigunguCd = bjdCode.substring(0, 5);
  const bjdongCd = bjdCode.substring(5, 10);
  const addrMatch = kaptAddr.match(/[동읍면리가]\s*(\d+)-?(\d*)/);
  if (!addrMatch) return null;
  const bun = addrMatch[1].padStart(4, '0');
  const ji = (addrMatch[2] || '0').padStart(4, '0');

  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${API_KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&_type=json&numOfRows=100`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  const raw = j?.response?.body?.items?.item;
  const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  const withRat = list.filter(b => parseFloat(b.vlRat) > 0);
  const best = withRat.sort((a, b) => (parseFloat(b.totArea) || 0) - (parseFloat(a.totArea) || 0))[0] || list[0];
  if (!best) return null;
  return {
    far: parseFloat(best.vlRat) > 0 ? String(best.vlRat) : null,
    bcr: parseFloat(best.bcRat) > 0 ? String(best.bcRat) : null,
  };
}

// Supabase 업데이트
async function updateSupabase(kaptCode, fields) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/apartments?kapt_code=eq.${kaptCode}`,
    {
      method: 'PATCH',
      headers: { ...supaHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(5000),
    }
  );
}

async function main() {
  console.log('누락 단지 목록 조회 중...');
  const missing = await getMissingList();
  const progress = loadProgress();
  const doneSet = new Set(progress.done);

  const todo = missing.filter(d => !doneSet.has(d.kapt_code));
  console.log(`전체 누락: ${missing.length}개 | 이미 완료: ${doneSet.size}개 | 오늘 처리할 것: ${Math.min(todo.length, DAILY_LIMIT)}개\n`);

  let count = 0;
  let ok = 0, fail = 0;

  for (const apt of todo) {
    if (count >= DAILY_LIMIT) {
      console.log(`\n하루 한도(${DAILY_LIMIT}건) 도달. 내일 다시 실행하세요.`);
      break;
    }

    count++;
    process.stdout.write(`[${count}/${Math.min(todo.length, DAILY_LIMIT)}] ${apt.name} (${apt.kapt_code})... `);

    try {
      // 1. V4 API
      const v4 = await getV4Info(apt.kapt_code);
      if (!v4) { console.log('V4 실패'); fail++; progress.failed.push(apt.kapt_code); continue; }

      // 2. 건축물대장 API
      const bld = await getBldInfo(v4.bjdCode, v4.kaptAddr);

      // 3. Supabase 저장
      const fields = {
        heat_name: v4.heatType,
        use_date: v4.completionYmd,
        sale_name: v4.saleType,
        ...(bld?.far ? { far: bld.far } : {}),
        ...(bld?.bcr ? { bcr: bld.bcr } : {}),
      };
      await updateSupabase(apt.kapt_code, fields);

      const got = bld?.far ? `용적률${bld.far}% 건폐율${bld.bcr}%` : '용적률 없음(건축물대장 미등록)';
      console.log(got);
      ok++;
      progress.done.push(apt.kapt_code);

    } catch (e) {
      console.log(`오류: ${e.message}`);
      fail++;
      progress.failed.push(apt.kapt_code);
    }

    // 진행상황 50개마다 저장
    if (count % 50 === 0) saveProgress(progress);

    await sleep(300); // 초당 ~3건 (API 부하 방지)
  }

  saveProgress(progress);
  console.log(`\n완료: ${ok}개 성공, ${fail}개 실패`);
  console.log(`남은 단지: ${todo.length - count}개`);
}

// Ctrl+C 시 진행상황 저장
process.on('SIGINT', () => { console.log('\n중단됨. 진행상황 저장됨.'); process.exit(); });

main().catch(console.error);
