#!/usr/bin/env node
/* =============================================================
 *  build_area_break.js — coords의 areaBreak(평형별 세대수)를 SQL로 추출
 *  목적: apt_metrics의 대표평형이 '거래 최빈'이라 소형 거래가 잦은
 *        혼합단지에서 소수 평형이 대표로 잡히는 문제(밴드 가드용 데이터).
 *  실행: cd C:\Users\essoz\GitHub\guhaedo && node scripts/build_area_break.js
 *  결과: scripts/build_area_break.sql  → Supabase SQL Editor에 붙여넣고 Run
 * ============================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'split_output');
const OUT = path.join(__dirname, 'build_area_break.sql');
const CHUNK = 4000;               // insert 한 문장당 행 수 (SQL Editor 부담 완화)

const files = fs.readdirSync(SRC).filter(f => /^coords_apt_.*\.json$/.test(f));
if (!files.length) { console.error('❌ split_output/coords_apt_*.json 없음'); process.exit(1); }

const rows = [];
let skipped = 0, zero = 0;

for (const f of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8')); }
  catch (e) { console.warn('  ! 파싱 실패 ' + f); continue; }
  for (const x of arr) {
    const ab = x.areaBreak;
    if (!x.code || !ab) { skipped++; continue; }
    const u60 = +ab.u60 || 0, u85 = +ab.u85 || 0, u135 = +ab.u135 || 0, o135 = +ab.o135 || 0;
    if (u60 + u85 + u135 + o135 === 0) { zero++; continue; }   // 구성 불명 → 가드 대상 제외(기존 최빈 유지)
    rows.push(`('${x.code.replace(/'/g, "''")}',${u60},${u85},${u135},${o135})`);
  }
}

const head = `-- =============================================================
--  apt_area_break — 단지별 평형 구성(세대수). coords의 areaBreak 그대로.
--  build_area_break.js 가 생성 (${new Date().toISOString().slice(0, 10)}, ${rows.length.toLocaleString()}개 단지)
--  용도: build_metrics.sql 의 대표평형 '밴드 가드'
--        → 대표평형을 세대수 최다 밴드 안에서 고르게 해, 소수 평형이 대표가 되는 걸 막음
--  ⚠️ RLS: 생성 직후 anon 읽기 막히므로 아래 disable 문을 반드시 단독 실행할 것
-- =============================================================

create table if not exists apt_area_break (
  kapt_code text primary key,
  u60   integer not null default 0,   -- 60㎡ 미만 세대수
  u85   integer not null default 0,   -- 60~85㎡
  u135  integer not null default 0,   -- 85~135㎡
  o135  integer not null default 0,   -- 135㎡ 이상
  units integer generated always as (u60+u85+u135+o135) stored
);

`;

const chunks = [];
for (let i = 0; i < rows.length; i += CHUNK) {
  chunks.push(
    'insert into apt_area_break (kapt_code,u60,u85,u135,o135) values\n' +
    rows.slice(i, i + CHUNK).join(',\n') +
    '\non conflict (kapt_code) do update set ' +
    'u60=excluded.u60, u85=excluded.u85, u135=excluded.u135, o135=excluded.o135;\n'
  );
}

const tail = `
-- ⚠️ 잠금 해제(RLS)는 scripts/build_area_break_rls.sql 로 분리했습니다.
--    이 파일을 Run 한 다음, 그 파일을 따로 Run 하세요.

-- 확인
select count(*) as 단지수,
       count(*) filter (where u60  = greatest(u60,u85,u135,o135)) as "주력_60㎡미만",
       count(*) filter (where u85  = greatest(u60,u85,u135,o135)) as "주력_60~85",
       count(*) filter (where u135 = greatest(u60,u85,u135,o135)) as "주력_85~135",
       count(*) filter (where o135 = greatest(u60,u85,u135,o135)) as "주력_135이상"
from apt_area_break;
`;

fs.writeFileSync(OUT, head + chunks.join('\n') + tail, 'utf8');
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`✅ ${OUT}`);
console.log(`   단지 ${rows.length.toLocaleString()}개 · ${chunks.length}개 insert 문 · ${kb}KB`);
console.log(`   제외: areaBreak 없음 ${skipped} / 전부 0 ${zero}`);
