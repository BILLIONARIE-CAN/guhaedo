// 용적률/건폐율 등 메타 데이터 누락 현황 조회
// 실행: cd C:\Users\essoz\GitHub\guhaedo && node check_missing_meta.js

const SUPABASE_URL = 'https://nqnbbccazjanjhktknyz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbmJiY2Nhemphbmpoa3Rrbnl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0OTA5NDQsImV4cCI6MjA5NTA2Njk0NH0.rT_hIwTJyBnCDGyudmJYvN44G67WgZ9-bSVCzShiRjI';

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

async function fetchAll(url) {
  let all = [], offset = 0;
  while (true) {
    const r = await fetch(`${url}&limit=1000&offset=${offset}`, { headers });
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function main() {
  console.log('Supabase apartments 테이블 메타 현황 조회 중...\n');

  const all = await fetchAll(
    `${SUPABASE_URL}/rest/v1/apartments?select=kapt_code,name,sido,far,bcr,heat_name,use_date,sale_name`
  );

  const total = all.length;
  const noFar    = all.filter(d => !d.far).length;
  const noBcr    = all.filter(d => !d.bcr).length;
  const noHeat   = all.filter(d => !d.heat_name).length;
  const noDate   = all.filter(d => !d.use_date).length;
  const noSale   = all.filter(d => !d.sale_name).length;
  const noBoth   = all.filter(d => !d.far || !d.bcr).length; // 하나라도 없으면 API 다시 호출함

  console.log(`전체 단지: ${total}개`);
  console.log(`용적률(far) 없음: ${noFar}개 (${(noFar/total*100).toFixed(1)}%)`);
  console.log(`건폐율(bcr) 없음: ${noBcr}개 (${(noBcr/total*100).toFixed(1)}%)`);
  console.log(`난방방식 없음: ${noHeat}개`);
  console.log(`준공일 없음: ${noDate}개`);
  console.log(`분양방식 없음: ${noSale}개`);
  console.log(`\n→ API 호출 필요한 단지(far 또는 bcr 없음): ${noBoth}개`);

  // 시도별 누락 현황
  const bySido = {};
  all.forEach(d => {
    if (!d.sido) return;
    if (!bySido[d.sido]) bySido[d.sido] = { total: 0, missing: 0 };
    bySido[d.sido].total++;
    if (!d.far || !d.bcr) bySido[d.sido].missing++;
  });

  console.log('\n--- 시도별 누락 현황 ---');
  Object.entries(bySido)
    .sort((a, b) => b[1].missing - a[1].missing)
    .forEach(([sido, s]) => {
      if (s.missing > 0)
        console.log(`  ${sido}: ${s.missing}/${s.total}개 누락`);
    });
}

main().catch(console.error);
