// =============================================================
//  전국 아파트 관리사무소 전화번호(kaptTel) 수집
//  → split_output/kapt_tel.json  (코드 → {tel, fax})
//
//  실행:  cd C:\Users\essoz\GitHub\guhaedo
//         node scripts/collect_kapt_tel.js
//
//  · K-apt 기본정보 API(getAphusBassInfoV4)에서 전화번호를 가져옵니다.
//    (api/apt.js가 이미 쓰는 그 API. 별도 신청/키 불필요)
//  · 하루 한도(약 1만콜)라 이번 실행은 BUDGET(기본 9000)개까지만 조회하고 멈춤.
//    다음 날 같은 명령을 다시 실행하면 "이어서" 합니다 (전국 ~3일).
//  · 첫 전화번호가 나오면 화면에 크게 찍어드립니다(검증용).
// =============================================================
const fs = require('fs');
const path = require('path');

const KEY = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf'; // api/apt.js와 동일
const SPLIT = path.join(__dirname, '..', 'split_output');
const OUT = path.join(SPLIT, 'kapt_tel.json');
const BUDGET = Number(process.env.BUDGET || 9000); // 이번 실행 최대 조회 수
const CONC = 5;                                     // 동시 요청 수

// 1) 전국 단지 코드 로드 (coords_apt_{시군구}.json 전부)
function loadCodes() {
  const codes = new Map(); // code -> name(참고용)
  for (const f of fs.readdirSync(SPLIT)) {
    if (!/^coords_apt_\d+\.json$/.test(f)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(SPLIT, f), 'utf8'));
      for (const a of arr) if (a && a.code) codes.set(a.code, a.name || '');
    } catch (e) {}
  }
  return codes;
}

// 2) 기존 결과 로드 (이어서 하기 위함)
let done = {};
if (fs.existsSync(OUT)) { try { done = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {} }

// 2b) 예전에 숫자만으로 저장된 항목을 형식(041-XXX-XXXX)으로 소급 정리
//     (fmtTel은 이미 형식이면 그대로 두므로 몇 번을 돌려도 안전)
{
  let fixed = 0;
  for (const c in done) {
    const t = fmtTel(done[c].tel), f = fmtTel(done[c].fax);
    if (t !== done[c].tel || f !== done[c].fax) { done[c] = { tel: t, fax: f }; fixed++; }
  }
  if (fixed) { fs.writeFileSync(OUT, JSON.stringify(done)); console.log(`기존 ${fixed}개 항목 전화번호 형식 재정리 완료`); }
}

// 전화번호를 지역번호에 맞춰 하이픈 포맷 (예: 041-000-0000, 02-000-0000, 1588-0000)
function fmtTel(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/[^0-9]/g, '');                 // 숫자만 남김(기존 하이픈/공백 제거)
  if (!d) return '';
  if (d.startsWith('82')) d = '0' + d.slice(2);               // +82 국가코드 → 0으로
  if (d.length === 8 && /^1[568]/.test(d))                    // 15xx/16xx/18xx 대표번호(지역번호 없음)
    return d.slice(0, 4) + '-' + d.slice(4);
  const area = d.startsWith('02') ? 2 : 3;                    // 서울(02)만 2자리, 나머지 3자리 지역번호
  const a = d.slice(0, area), rest = d.slice(area);
  if (rest.length === 8) return `${a}-${rest.slice(0, 4)}-${rest.slice(4)}`; // 0XX-XXXX-XXXX
  if (rest.length === 7) return `${a}-${rest.slice(0, 3)}-${rest.slice(3)}`; // 0XX-XXX-XXXX
  if (rest.length > 4)   return `${a}-${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  if (rest.length === 4) return `${a}-${rest}`;
  return d;                                                   // 형식 못 맞추면 숫자 그대로
}

// 3) 단지 하나의 전화번호 조회
async function fetchTel(code) {
  const url = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4`
            + `?serviceKey=${encodeURIComponent(KEY)}&kaptCode=${code}&_type=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const item = JSON.parse(await r.text())?.response?.body?.item;
    if (!item) return null;
    return { tel: fmtTel(item.kaptTel), fax: fmtTel(item.kaptFax) };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const codes = loadCodes();
  const todo = [...codes.keys()].filter(c => !(c in done));
  console.log(`전국 단지 ${codes.size}개 · 이미 수집 ${Object.keys(done).length}개 · 남은 ${todo.length}개`);
  console.log(`이번 실행 최대 ${BUDGET}개 조회 (동시 ${CONC})\n`);

  const batch = todo.slice(0, BUDGET);
  let n = 0, ok = 0, firstShown = false;

  for (let i = 0; i < batch.length; i += CONC) {
    const slice = batch.slice(i, i + CONC);
    const results = await Promise.all(slice.map(fetchTel));
    slice.forEach((code, j) => {
      const r = results[j]; n++;
      if (r) {
        done[code] = { tel: r.tel, fax: r.fax };
        if (r.tel) {
          ok++;
          if (!firstShown) {
            firstShown = true;
            console.log(`\n검증 ✅ 첫 전화번호: ${codes.get(code)} (${code}) → ${r.tel}\n`);
          }
        }
      }
    });
    if (n % 200 < CONC) {
      fs.writeFileSync(OUT, JSON.stringify(done));
      console.log(`  진행 ${n}/${batch.length}  (전화번호 확보 누적 ${Object.values(done).filter(v => v.tel).length})`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(done));
  const withTel = Object.values(done).filter(v => v.tel).length;
  const remaining = todo.length - batch.length;
  console.log(`\n이번 실행 완료: ${n}개 조회. 전화번호 있는 단지 누적 ${withTel}개 / 전체 수집 ${Object.keys(done).length}개.`);
  if (remaining > 0) {
    console.log(`남은 ${remaining}개 → 내일 'node scripts/collect_kapt_tel.js' 다시 실행하면 이어서 합니다.`);
  } else {
    console.log(`🎉 전국 관리사무소 전화번호 수집 완료! → split_output/kapt_tel.json`);
  }
})();
