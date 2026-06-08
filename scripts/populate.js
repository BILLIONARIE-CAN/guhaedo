// node scripts/populate.js

const SECRET = 'guh2024xK9mPq7';
const BASE = 'https://guhaedo.kr';

async function run() {
  let offset = 0, total = 0;
  while (true) {
    const r = await fetch(`${BASE}/api/populate?secret=${SECRET}&offset=${offset}`);
    const d = await r.json();
    total += d.far_count || 0;
    process.stdout.write(`\r[${offset}] 처리: ${d.processed}개, 용적률 획득: ${d.far_count}개, 누적: ${total}개`);
    if (d.quota_exceeded) { console.log('\nAPI 일일 한도 초과 — 내일 다시 실행하세요'); break; }
    if (d.done || !d.processed) break;
    offset = d.next_offset;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`\n완료! 총 ${total}개 저장`);
}

run().catch(console.error);
