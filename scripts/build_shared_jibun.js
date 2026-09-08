// 지번(법정동+본번+부번)을 2개 이상 단지가 공유하는 목록을 만든다.
//  → api/trade.js, api/warm.js 가 "지번만 같으면 무조건 매칭" 하지 않도록 하는 근거 데이터.
//  실행: node scripts/build_shared_jibun.js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'split_output', 'coords_all_apt.json');
const out = path.join(__dirname, '..', 'split_output', 'shared_jibun.json');

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const arr = Array.isArray(raw) ? raw : Object.values(raw);

function jibunKey(a) {
  if (!a.jibunAddr) return null;
  const m = String(a.jibunAddr).match(/([가-힣0-9]+(?:동|리|가))\s+(\d+)(?:-\s*(\d+))?/);
  if (!m) return null;
  return [String(a.sigunguCode || ''), m[1], m[2], m[3] || ''].join('|');
}

const groups = {};
for (const a of arr) {
  const k = jibunKey(a);
  if (!k || !a.code || !a.name) continue;
  (groups[k] = groups[k] || []).push({ code: a.code, name: a.name, ab: a.areaBreak || null });
}

// 같은 code 가 중복 등장하는 경우 정리
const result = {};
let groupCnt = 0;
for (const k of Object.keys(groups)) {
  const seen = new Set();
  const members = groups[k].filter(m => (seen.has(m.code) ? false : (seen.add(m.code), true)));
  if (members.length < 2) continue;
  groupCnt++;
  for (const m of members) {
    result[m.code] = {
      // 형제 단지 이름 (단지명으로 거래 주인을 가려낼 때 씀)
      sibs: members.filter(x => x.code !== m.code).map(x => x.name),
      // 이 단지의 평형 구성 — 없는 평형의 거래는 이 단지 것일 수 없다
      //   u60: 60㎡ 미만 / u85: 60~85 / u135: 85~135 / o135: 135 이상
      ab: m.ab
    };
  }
}

fs.writeFileSync(out, JSON.stringify(result), 'utf8');
console.log('지번 공유 묶음:', groupCnt);
console.log('영향 단지:', Object.keys(result).length);
console.log('파일:', out, (fs.statSync(out).size / 1024).toFixed(1) + 'KB');
