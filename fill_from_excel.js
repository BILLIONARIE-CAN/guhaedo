/**
 * fill_from_excel.js
 * 20260605_단지_기본정보.xlsx 에서 누락 필드를 split_output JSON에 채웁니다.
 *
 * 채우는 필드: entrance(복도유형), builder(시공사), totalPark(총주차대수),
 *              units(세대수 0인 경우), dongCnt(동수), topFloor(최고층수)
 *
 * 사용법:
 *   npm install xlsx        ← 처음 한 번만
 *   node fill_from_excel.js
 */

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

// ★ 엑셀 파일 경로 (바탕화면\files 폴더)
const EXCEL_PATH   = 'C:\\Users\\essoz\\Desktop\\files\\20260605_단지_기본정보.xlsx';
const SPLIT_DIR    = path.join(__dirname, 'split_output');
const ALL_APT_PATH = path.join(__dirname, 'split_output', 'coords_all_apt.json');

// ── 1. 엑셀 읽기 ──────────────────────────────────────────
console.log('엑셀 읽는 중...');
const wb  = XLSX.readFile(EXCEL_PATH);
const ws  = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

// 2행이 실제 헤더
const headers = raw[1];
const colIdx  = {};
['단지코드','세대수','복도유형','시공사','총주차대수','동수','최고층수'].forEach(h => {
  const i = headers.indexOf(h);
  if (i >= 0) colIdx[h] = i;
  else console.warn('⚠️ 컬럼 없음:', h);
});
console.log('컬럼 위치:', colIdx);

// ── 2. 룩업 맵 생성 ──────────────────────────────────────
const lookup = {};
for (let r = 2; r < raw.length; r++) {
  const row  = raw[r];
  const code = row[colIdx['단지코드']];
  if (!code) continue;
  lookup[code] = {
    units:     parseInt(row[colIdx['세대수']])      || 0,
    entrance:  (row[colIdx['복도유형']] || '').trim(),
    builder:   (row[colIdx['시공사']]  || '').trim(),
    totalPark: parseInt(row[colIdx['총주차대수']]) || 0,
    dongCnt:   row[colIdx['동수']] ? String(row[colIdx['동수']]).trim() + '동' : '',
    topFloor:  parseInt(row[colIdx['최고층수']]) || 0,
  };
}
console.log(`엑셀 단지 수: ${Object.keys(lookup).length}`);

// ── 3. split_output JSON 갱신 ────────────────────────────
const files = fs.readdirSync(SPLIT_DIR)
  .filter(f => f.startsWith('coords_apt_') && f.endsWith('.json'));

let totalUpdated = 0, totalFiles = 0;

for (const file of files) {
  const fp   = path.join(SPLIT_DIR, file);
  const apts = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let changed = false;

  apts.forEach(apt => {
    const ex = lookup[apt.code];
    if (!ex) return;
    let u = false;

    if ((!apt.units || apt.units === 0) && ex.units > 0)           { apt.units     = ex.units;     u=true; }
    if (!apt.entrance && ex.entrance)                               { apt.entrance  = ex.entrance;  u=true; }
    if (!apt.builder  && ex.builder)                                { apt.builder   = ex.builder;   u=true; }
    if ((!apt.totalPark || apt.totalPark === 0) && ex.totalPark>0) { apt.totalPark = ex.totalPark; u=true; }
    if (!apt.dongCnt  && ex.dongCnt)                               { apt.dongCnt   = ex.dongCnt;   u=true; }
    if (!apt.topFloor && ex.topFloor > 0)                          { apt.topFloor  = ex.topFloor;  u=true; }

    if (u) { changed = true; totalUpdated++; }
  });

  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(apts), 'utf8');
    totalFiles++;
    process.stdout.write(`\r저장: ${totalFiles}파일 / ${totalUpdated}건`);
  }
}
console.log(`\n\n split_output 갱신 완료: ${totalFiles}개 파일 / ${totalUpdated}건`);

// ── 4. coords_all_apt.json 갱신 ──────────────────────────
if (fs.existsSync(ALL_APT_PATH)) {
  console.log('coords_all_apt.json 갱신중...');
  const all = JSON.parse(fs.readFileSync(ALL_APT_PATH, 'utf8'));
  all.forEach(apt => {
    const ex = lookup[apt.code];
    if (!ex) return;
    if ((!apt.units || apt.units===0) && ex.units>0)           apt.units     = ex.units;
    if (!apt.entrance && ex.entrance)                           apt.entrance  = ex.entrance;
    if (!apt.builder  && ex.builder)                            apt.builder   = ex.builder;
    if ((!apt.totalPark||apt.totalPark===0) && ex.totalPark>0) apt.totalPark = ex.totalPark;
    if (!apt.dongCnt  && ex.dongCnt)                            apt.dongCnt   = ex.dongCnt;
    if (!apt.topFloor && ex.topFloor>0)                         apt.topFloor  = ex.topFloor;
  });
  fs.writeFileSync(ALL_APT_PATH, JSON.stringify(all), 'utf8');
  console.log('coords_all_apt.json 완료');
}

console.log('\n✅ 완료! 아래 명령어로 push 하세요:');
console.log('cd C:\\Users\\essoz\\Desktop\\guhaedo');
console.log('git add . && git commit -m "엑셀 데이터로 주차/복도유형/시공사/세대수 보완" && git push');
