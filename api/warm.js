// =============================================================
//  실거래가 캐시 워밍 — 시군구(lawd_cd)+월 단위로 국토부에서 받아
//  그 시군구 안 모든 단지에 매칭해서 apt_transactions에 저장.
//  - 진행상황은 warm_state 테이블(id=1)에 cursor로 기록 → 이어하기
//  - 하루 국토부 호출 한도(DAILY_CALL_CAP) 넘으면 자동 정지, 다음날 재개
//  - 외부 크론(cron-job.org 등)이 /api/warm?secret=... 를 몇 분마다 호출
//  전국 ≈ 6,000 태스크(250시군구 × 24개월), 하루 3,000태스크 → 약 2일
// =============================================================
const APTS = require('../split_output/coords_all_apt.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GKEY = encodeURIComponent('8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf');
const WARM_SECRET = '3c4fc034da972bac20f024ef003bf1ec';

const DAILY_CALL_CAP = 9000;  // 국토부 하루 호출 한도 여유분 (3콜/태스크 → 3000태스크/일)
const RUN_TASK_CAP = 6;       // 1회 실행당 태스크 수 (Hobby 10초 대응)
const TIME_BUDGET_MS = 7000;

// ── 주소 파싱: jibunAddr/addr → 법정동, 지번 ──
function deriveDongJibun(a) {
  const addr = (a.jibunAddr || a.addr || '').trim();
  let dong = '', jibun = '';
  if (addr) {
    const parts = addr.replace(/\s+/g, ' ').split(' ');
    let passedGungu = false; const dongs = [];
    for (const p of parts) {
      if (/^산?\d+(-\d+)?(번지)?$/.test(p)) { jibun = p.replace(/번지$/, ''); break; }
      if (!passedGungu) { if (/[시군구]$/.test(p)) passedGungu = true; continue; }
      if (/[동읍면리가]$/.test(p)) dongs.push(p);
    }
    if (dongs.length) dong = dongs.join(' ');
  }
  return { dong, jibun };
}

// ── 시군구별 단지 그룹 (콜드스타트 1회) ──
const APT_BY_LAWD = new Map();
for (const a of APTS) {
  if (!a || !a.code) continue;
  const lawd = String(a.sigunguCode || '').slice(0, 5);
  if (lawd.length !== 5) continue;
  const { dong, jibun } = deriveDongJibun(a);
  const rec = { code: a.code, name: (a.name || '').trim(), dong, jibun, built: parseInt(String(a.built || '').slice(0, 4)) || 0 };
  if (!APT_BY_LAWD.has(lawd)) APT_BY_LAWD.set(lawd, []);
  APT_BY_LAWD.get(lawd).push(rec);
}
const LAWDS = [...APT_BY_LAWD.keys()].sort();
const MONTHS = (function () { const out = []; const now = new Date(); for (let i = 0; i < 24; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`); } return out; })();
const TOTAL_TASKS = LAWDS.length * MONTHS.length;

// ── 매칭 (trade.js 이식) ──
function parsePrice(s) { return parseInt(String(s || '0').replace(/[^0-9]/g, '')) || 0; }
function parseJibun(s) { const m = String(s || '').trim().match(/^산?(\d+)(?:-(\d+))?/); return m ? { bon: parseInt(m[1]), bu: m[2] != null ? parseInt(m[2]) : null } : null; }
function jbCompat(a, b) { return !!(a && b && a.bon === b.bon && (a.bu == null || b.bu == null || a.bu === b.bu)); }
const normalize = s => { let t = String(s || '').trim().replace(/[\s()（）·\-\/]/g, '').toUpperCase(); for (let i = 0; i < 2; i++) t = t.replace(/(아파트|APT|맨션|관리사무소|관리동)$/, ''); return t; };

function makeMatcher(rec) {
  const myJibun = parseJibun(rec.jibun);
  const myDongPart = (rec.dong || '').replace(/\s/g, '');
  const myName = normalize(rec.name);
  const builtYear = rec.built;
  const buildYearMatch = x => { if (!builtYear) return true; const by = parseInt(x.buildYear || '0'); if (!by) return true; return by >= builtYear - 1 && by <= builtYear + 1; };
  const dongMatch = x => { if (!myDongPart) return true; const xd = (x.umdNm || '').replace(/\s/g, ''); if (!xd) return true; return myDongPart.includes(xd) || xd.includes(myDongPart); };
  const addrMatch = x => { if (!myJibun || !myDongPart) return false; const xj = parseJibun(x.jibun); if (!xj || xj.bon !== myJibun.bon) return false; if (myJibun.bu != null && xj.bu != null && xj.bu !== myJibun.bu) return false; return dongMatch(x); };
  const jibunSoft = x => { if (!myJibun) return true; const xj = parseJibun(x.jibun); return !xj || xj.bon === myJibun.bon; };
  return function (x) {
    if ((x.cdealType || '').trim()) return false;
    if (!buildYearMatch(x)) return false;
    if (addrMatch(x)) return true;
    const n = normalize(x.aptNm); if (!n || !myName) return false;
    const xj = parseJibun(x.jibun);
    if (n === myName) { if (dongMatch(x)) return myDongPart ? true : jibunSoft(x); return !!(xj && myJibun && xj.bon === myJibun.bon && xj.bu != null && myJibun.bu != null && xj.bu === myJibun.bu); }
    if (!dongMatch(x)) return false;
    const L = Math.min(n.length, myName.length); if (L < 4) return false;
    if (!(n.includes(myName) || myName.includes(n))) return false;
    const big = n.length >= myName.length ? n : myName; const small = big === n ? myName : n; const extra = big.replace(small, '');
    const bonOk = jbCompat(xj, myJibun);
    if (L >= 5) return bonOk || (!/\d/.test(extra) && extra.length <= 4);
    return bonOk;
  };
}

const mapT = x => `${parseInt(x.dealYear)}-${String(parseInt(x.dealMonth) || 1).padStart(2, '0')}`;
function parseItems(json) { const raw = json?.response?.body?.items?.item; if (!raw) return []; return Array.isArray(raw) ? raw : [raw]; }

const buyBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
const rentBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
const preBase = 'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';

const supaHeaders = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

async function getState() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/warm_state?id=eq.1&select=*`, { headers: supaHeaders(), signal: AbortSignal.timeout(4000) });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch { return null; }
}
async function saveState(cursor, calls_today, day) {
  await fetch(`${SUPABASE_URL}/rest/v1/warm_state`, { method: 'POST', headers: { ...supaHeaders(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: 1, cursor, calls_today, day }), signal: AbortSignal.timeout(4000) }).catch(() => {});
}

const safeJ = (u, ms) => fetch(u, { signal: AbortSignal.timeout(ms) })
  .then(r => r.json())
  .then(j => { const c = j?.response?.header?.resultCode; if (c && c !== '00' && c !== '000') return { items: [], err: true }; return { items: parseItems(j), err: false }; })
  .catch(() => ({ items: [], err: true }));

module.exports = async (req, res) => {
  if ((req.query.secret || '') !== WARM_SECRET) { res.status(403).json({ error: 'forbidden' }); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) { res.status(200).json({ ok: false, reason: 'no env' }); return; }

  // 상태 확인 전용(HTML, 워밍 안 함) — 알림/모니터링용
  if (req.query.status === '1') {
    const st = await getState();
    const cursor = st ? (st.cursor || 0) : 0;
    const pct = ((cursor / TOTAL_TASKS) * 100).toFixed(1);
    const done = cursor >= TOTAL_TASKS;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:20px;line-height:1.7">`
      + `<h2>실거래가 워밍 상태</h2>`
      + `<p>진행률: <b>${pct}%</b> (${cursor} / ${TOTAL_TASKS} 태스크)</p>`
      + `<p>오늘 국토부 호출: ${st ? (st.calls_today || 0) : 0} · 마지막 실행일: ${st ? (st.day || '-') : '-'}</p>`
      + `<p><b>${done ? '✅ 전국 워밍 완료' : '⏳ 진행 중'}</b></p>`
      + `</body>`);
    return;
  }

  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const st = await getState();
  let cursor = st ? (st.cursor || 0) : 0;
  let calls_today = st ? (st.day === today ? (st.calls_today || 0) : 0) : 0;

  if (cursor >= TOTAL_TASKS) { res.status(200).json({ done: true, msg: '전체 워밍 완료', totalTasks: TOTAL_TASKS }); return; }
  if (calls_today >= DAILY_CALL_CAP) { res.status(200).json({ ok: true, paused: 'daily cap 도달', cursor, percent: ((cursor / TOTAL_TASKS) * 100).toFixed(1) + '%', calls_today }); return; }

  let processed = 0;
  while (processed < RUN_TASK_CAP && cursor < TOTAL_TASKS && calls_today < DAILY_CALL_CAP && (Date.now() - t0) < TIME_BUDGET_MS) {
    const lawd = LAWDS[Math.floor(cursor / MONTHS.length)];
    const ym = MONTHS[cursor % MONTHS.length];
    const complexes = APT_BY_LAWD.get(lawd) || [];

    const [bR, rR, pR] = await Promise.all([
      safeJ(`${buyBase}?serviceKey=${GKEY}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`, 4500),
      safeJ(`${rentBase}?serviceKey=${GKEY}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`, 4500),
      safeJ(`${preBase}?serviceKey=${GKEY}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&_type=json`, 4000),
    ]);
    calls_today += 3;

    // 코어(매매·전월세) 에러 = 한도초과/장애 가능성 → 빈데이터 박제 방지 위해 캐싱 스킵 + 정지
    if (bR.err || rR.err) {
      await saveState(cursor, calls_today, today);
      res.status(200).json({ ok: true, stopped: 'API 오류(한도초과 가능) — 다음 실행에서 재개', cursor, percent: ((cursor / TOTAL_TASKS) * 100).toFixed(1) + '%', calls_today });
      return;
    }

    const bRaw = bR.items, rRaw = rR.items, pRaw = pR.items;
    const rows = [];
    for (const rec of complexes) {
      const match = makeMatcher(rec);
      const buy = bRaw.filter(match).map(x => ({ t: mapT(x), day: String(x.dealDay || '').trim(), p: parsePrice(x.dealAmount), a: parseFloat(x.excluUseAr || 0), f: String(x.floor || '').trim() }));
      pRaw.filter(match).forEach(x => buy.push({ t: mapT(x), day: String(x.dealDay || '').trim(), p: parsePrice(x.dealAmount), a: parseFloat(x.excluUseAr || 0), f: String(x.floor || '').trim(), pre: String(x.ownershipGbn || '').trim().startsWith('입') ? '입' : '분' }));
      const rents = rRaw.filter(match);
      const jeonse = rents.filter(x => !parsePrice(x.monthlyRent)).map(x => ({ t: mapT(x), day: String(x.dealDay || '').trim(), p: parsePrice(x.deposit), a: parseFloat(x.excluUseAr || 0), f: String(x.floor || '').trim() }));
      const monthly = rents.filter(x => parsePrice(x.monthlyRent) > 0).map(x => ({ t: mapT(x), day: String(x.dealDay || '').trim(), d: parsePrice(x.deposit), m: parsePrice(x.monthlyRent), a: parseFloat(x.excluUseAr || 0), f: String(x.floor || '').trim() }));
      rows.push({ kapt_code: rec.code, ym, buy, jeonse, monthly, lawd_cd: lawd, apt_name: [rec.name, rec.dong, rec.jibun].join('|'), fetched_at: new Date().toISOString() });
    }
    if (rows.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/apt_transactions`, { method: 'POST', headers: { ...supaHeaders(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows), signal: AbortSignal.timeout(8000) }).catch(() => {});
    }
    cursor++; processed++;
  }

  await saveState(cursor, calls_today, today);
  res.status(200).json({ ok: true, processed, cursor, totalTasks: TOTAL_TASKS, percent: ((cursor / TOTAL_TASKS) * 100).toFixed(1) + '%', calls_today, day: today });
};
