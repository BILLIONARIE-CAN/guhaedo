// 미등록 아파트 발견 스크립트
//
// 사용법:
//   cd C:\Users\essoz\GitHub\guhaedo && node scripts\discover.js [lawd_cd] [sido] [sigungu] [months] [--dry]
//
// 예시:
//   node scripts\discover.js 11680 서울특별시 강남구 3 --dry   ← 추가 없이 미등록 목록만 확인
//   node scripts\discover.js 11680 서울특별시 강남구 3         ← 실제 추가
//   node scripts\discover.js 41135 경기도 성남시분당구 6       ← 최근 6개월 조회
//
// lawd_cd 주요 코드 (시군구 5자리):
//   서울 강남구=11680, 서초구=11650, 송파구=11710, 강동구=11740
//   경기 성남분당=41135, 수원영통=41115, 용인수지=41465
//   인천 연수구=28185, 부평구=28237
//   부산 해운대=26350

const SECRET = 'guh2024xK9mPq7';
const BASE = 'https://guhaedo.kr';

async function run() {
  const args = process.argv.slice(2);
  const isDry = args.includes('--dry');
  const filtered = args.filter(a => a !== '--dry');

  const [lawd_cd, sido, sigungu, months = '3'] = filtered;

  if (!lawd_cd || !sido || !sigungu) {
    console.log('\n사용법: node scripts\\discover.js [lawd_cd] [sido] [sigungu] [months] [--dry]');
    console.log('예시: node scripts\\discover.js 11680 서울특별시 강남구 3 --dry\n');
    process.exit(1);
  }

  console.log(`\n[미등록 아파트 발견] ${sido} ${sigungu} (lawd_cd=${lawd_cd}), 최근 ${months}개월`);
  if (isDry) console.log('[dry-run 모드: 추가하지 않음]');
  console.log('실거래 API 조회 중...\n');

  const url = `${BASE}/api/discover?secret=${SECRET}`
    + `&lawd_cd=${lawd_cd}`
    + `&sido=${encodeURIComponent(sido)}`
    + `&sigungu=${encodeURIComponent(sigungu)}`
    + `&months=${months}`
    + `&dry_run=${isDry}`;

  let d;
  try {
    const r = await fetch(url);
    d = await r.json();
  } catch(e) {
    console.error('API 호출 실패:', e.message);
    process.exit(1);
  }

  if (d.error) { console.error('오류:', d.error); process.exit(1); }

  console.log(`실거래 아파트 총 ${d.total_in_transactions}개`);
  console.log(`DB 등록: ${d.already_in_db}개`);
  console.log(`미등록: ${d.missing_count}개`);

  if (isDry || d.dry_run) {
    if (d.missing?.length) {
      console.log('\n[미등록 아파트 목록]');
      d.missing.forEach(name => console.log(' -', name));
    } else {
      console.log('\n미등록 아파트 없음 — 모두 등록되어 있습니다.');
    }
    console.log('\n실제 추가하려면 --dry 없이 실행하세요.');
  } else {
    console.log(`\n추가 성공: ${d.added}개`);
    console.log(`좌표 실패: ${d.failed_geocode}개`);
    if (d.added_list?.length) {
      console.log('\n[추가된 아파트]');
      d.added_list.forEach(a => console.log(` ✓ ${a.name} | ${a.addr} | (${a.lat.toFixed(5)}, ${a.lng.toFixed(5)})`));
    }
  }
  console.log('');
}

run().catch(console.error);
