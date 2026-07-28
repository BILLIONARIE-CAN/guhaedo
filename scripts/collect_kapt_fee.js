// =============================================================
//  전국 아파트 관리비(avgFee) 수집 → kapt_tel.json 과 병합
//  → split_output/kapt_info.json  (코드 → {tel, fax, avgFee, ym})
//
//  실행:  cd C:\Users\essoz\GitHub\guhaedo
//         node scripts/collect_kapt_fee.js
//
//  · K-apt 관리비 API(getAptMgrcostInfoV4)에서 세대당 평균 관리비를 가져옵니다.
//  · 기존 kapt_tel.json(전화번호)과 병합해 kapt_info.json 하나로 저장합니다.
//  · 하루 한도(약 1만콜)라 BUDGET(기본 9000)개까지만 조회하고 멈춤.
//    다음 날 같은 명령을 다시 실행하면 이어서 합니다 (전국 ~3일).
// =============================================================
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function notify(title, msg) {
  try {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; `
      + `[System.Windows.Forms.MessageBox]::Show('${msg.replace(/'/g, "''")}', '${title.replace(/'/g, "''")}')`;
    // 토스트 알림 (Windows 10/11)
    const toast = `powershell -Command "`
      + `$n = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]; `
      + `$t = [Windows.UI.Notifications.ToastTemplateType]::ToastText02; `
      + `$xml = $n::GetTemplateContent($t); `
      + `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${title.replace(/"/g, '\\"')}')) | Out-Null; `
      + `$xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode('${msg.replace(/"/g, '\\"')}')) | Out-Null; `
      + `$toast = [Windows.UI.Notifications.ToastNotification]::new($xml); `
      + `$n::CreateToastNotifier('아구구').Show($toast)"`;
    execSync(toast, { stdio: 'ignore', timeout: 5000 });
  } catch (e) {
    // 알림 실패해도 스크립트는 정상 종료
  }
}

const KEY    = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';
const SPLIT  = path.join(__dirname, '..', 'split_output');
const TEL_F  = path.join(SPLIT, 'kapt_tel.json');
const OUT    = path.join(SPLIT, 'kapt_info.json');
const BUDGET = Number(process.env.BUDGET || 9000);
const CONC   = 5;

// 1) 전국 단지 코드 로드
function loadCodes() {
  const codes = new Map();
  for (const f of fs.readdirSync(SPLIT)) {
    if (!/^coords_apt_\d+\.json$/.test(f)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(SPLIT, f), 'utf8'));
      for (const a of arr) if (a && a.code) codes.set(a.code, a.name || '');
    } catch (e) {}
  }
  return codes;
}

// 2) 기존 kapt_tel.json 로드 (전화번호 재활용)
let tel = {};
if (fs.existsSync(TEL_F)) { try { tel = JSON.parse(fs.readFileSync(TEL_F, 'utf8')); } catch (e) {} }
console.log(`전화번호 기존 데이터: ${Object.keys(tel).length}개`);

// 3) 기존 kapt_info.json 로드 (이어서 하기)
let info = {};
if (fs.existsSync(OUT)) { try { info = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {} }
console.log(`관리비 기존 데이터: ${Object.keys(info).length}개`);

// 4) 관리비 API 호출 (단지 하나)
async function fetchFee(code) {
  const url = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAptMgrcostInfoV4`
            + `?serviceKey=${encodeURIComponent(KEY)}&kaptCode=${code}&_type=json&numOfRows=100`;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r    = await fetch(url, { signal: ctrl.signal });
    const data = JSON.parse(await r.text());
    const raw  = data?.response?.body?.items?.item;
    if (!raw) return null;

    const items = Array.isArray(raw) ? raw : [raw];
    if (!items.length) return null;

    // 가장 최근 월 기준으로 항목 합산
    const byYm = {};
    for (const it of items) {
      const ym  = String(it.inqYm || '');
      const amt = Number(it.pymAmt) || 0;
      if (!ym || amt <= 0) continue;
      byYm[ym] = (byYm[ym] || 0) + amt;
    }

    const yms = Object.keys(byYm).sort().reverse(); // 최신 월 우선
    if (!yms.length) return null;

    const latestYm  = yms[0];
    const avgFee    = Math.round(byYm[latestYm]);   // 세대당 월 평균 관리비 (원)
    return { avgFee, ym: latestYm };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 5) 병합 저장 (tel + fee → info)
function save() {
  // kapt_tel.json의 tel/fax를 최신 상태로 반영
  for (const code in tel) {
    info[code] = { ...tel[code], ...(info[code] || {}) };
  }
  fs.writeFileSync(OUT, JSON.stringify(info));
}

(async () => {
  const codes = loadCodes();

  // 관리비가 아직 없는 코드만 조회
  const todo = [...codes.keys()].filter(c => !(c in info) || info[c].avgFee === undefined);
  console.log(`전국 단지 ${codes.size}개 · 관리비 없는 ${todo.length}개 조회 예정`);
  console.log(`이번 실행 최대 ${BUDGET}개 (동시 ${CONC})\n`);

  // 초기 병합 (기존 tel 데이터 반영)
  for (const code in tel) {
    if (!info[code]) info[code] = {};
    info[code].tel = tel[code].tel || '';
    info[code].fax = tel[code].fax || '';
  }

  const batch = todo.slice(0, BUDGET);
  let n = 0, ok = 0, firstShown = false;

  for (let i = 0; i < batch.length; i += CONC) {
    const slice   = batch.slice(i, i + CONC);
    const results = await Promise.all(slice.map(fetchFee));

    slice.forEach((code, j) => {
      const r = results[j];
      n++;
      if (!info[code]) info[code] = {};
      // tel/fax 유지
      if (tel[code]) { info[code].tel = tel[code].tel || ''; info[code].fax = tel[code].fax || ''; }
      if (r) {
        info[code].avgFee = r.avgFee;
        info[code].ym     = r.ym;
        ok++;
        if (!firstShown) {
          firstShown = true;
          console.log(`\n검증 ✅ 첫 관리비: ${codes.get(code)} (${code}) → ${r.avgFee.toLocaleString()}원/세대 (${r.ym})\n`);
        }
      } else {
        // 데이터 없음 표시 (재조회 방지)
        info[code].avgFee = null;
        info[code].ym     = null;
      }
    });

    if (n % 200 < CONC) {
      save();
      console.log(`  진행 ${n}/${batch.length}  (관리비 확보 누적 ${ok})`);
    }
  }

  save();
  const withFee = Object.values(info).filter(v => v.avgFee > 0).length;
  const remaining = todo.length - batch.length;
  console.log(`\n이번 실행 완료: ${n}개 조회. 관리비 있는 단지 ${withFee}개 / 전체 ${Object.keys(info).length}개.`);
  if (remaining > 0) {
    console.log(`남은 ${remaining}개 → 내일 'node scripts/collect_kapt_fee.js' 다시 실행하면 이어서 합니다.`);
    notify('아구구 관리비 수집', `오늘 ${n}개 완료. 관리비 확보 ${withFee}개. 내일 이어서 실행하세요.`);
  } else {
    console.log(`🎉 전국 관리비 수집 완료! → split_output/kapt_info.json`);
    notify('아구구 관리비 수집 완료 🎉', `전국 ${withFee}개 단지 관리비 수집 완료! kapt_info.json 저장됨.`);
  }
})();
