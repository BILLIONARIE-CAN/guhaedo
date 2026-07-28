// 공동주택 공용관리비 온디맨드 조회 + Supabase 캐시(월 1회 갱신)
//   /api/mgmtcost?code=KAPT_CODE&units=세대수
//   - K-apt 공용관리비 서비스(AptCmnuseManageCostServiceV2)의 17개 항목을 병렬 호출
//   - 각 응답 item의 숫자 필드를 통째로 합산(필드명 하드코딩 불필요) → 항목별 금액
//   - 단지 전체 월 공용관리비 합계 total, 세대당 perHousehold(원/세대/월)
//   - Supabase apt_mgmtcost 테이블에 캐시(30일 지나면 다음 조회 때 재수집)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const KEY  = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';
const BASE = 'https://apis.data.go.kr/1613000/AptCmnuseManageCostServiceV2';

// [오퍼레이션, 표시라벨] — 공용관리비 17개 항목
const OPS = [
  ['getHsmpLaborCostInfoV2',              '인건비'],
  ['getHsmpOfcrkCostInfoV2',              '제사무비'],
  ['getHsmpTaxdueInfoV2',                 '제세공과금'],
  ['getHsmpClothingCostInfoV2',           '피복비'],
  ['getHsmpEduTraingCostInfoV2',          '교육훈련비'],
  ['getHsmpVhcleMntncCostInfoV2',         '차량유지비'],
  ['getHsmpEtcCostInfoV2',                '그밖의 부대비용'],
  ['getHsmpCleaningCostInfoV2',           '청소비'],
  ['getHsmpGuardCostInfoV2',              '경비비'],
  ['getHsmpDisinfectionCostInfoV2',       '소독비'],
  ['getHsmpElevatorMntncCostInfoV2',      '승강기 유지비'],
  ['getHsmpHomeNetworkMntncCostInfoV2',   '홈네트워크 유지비'],
  ['getHsmpRepairsCostInfoV2',            '수선비'],
  ['getHsmpFacilityMntncCostInfoV2',      '시설유지비'],
  ['getHsmpSafetyCheckUpCostInfoV2',      '안전점검비'],
  ['getHsmpDisasterPreventionCostInfoV2', '재해예방비'],
  ['getHsmpConsignManageFeeInfoV2',       '위탁관리 수수료'],
];

function supaHeaders() {
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
}

async function readCache(code) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/apt_mgmtcost?kapt_code=eq.${encodeURIComponent(code)}&select=ym,total,per_hshld,detail,fetched_at`,
      { headers: supaHeaders() }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const row = rows[0];
    const age = Date.now() - new Date(row.fetched_at).getTime();
    if (age > 30 * 86400000) return null; // 월 1회 갱신
    return row;
  } catch (e) { return null; }
}

function writeCache(code, ym, total, per, detail) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/apt_mgmtcost`, {
    method: 'POST',
    headers: { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify([{ kapt_code: code, ym, total, per_hshld: per, detail, fetched_at: new Date().toISOString() }]),
  }).catch(() => {});
}

// item(객체 또는 배열)에서 kaptCode/kaptName 제외한 숫자 필드 전부 합산
function sumItem(item) {
  if (!item) return 0;
  const arr = Array.isArray(item) ? item : [item];
  let s = 0;
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    for (const k in it) {
      if (k === 'kaptCode' || k === 'kaptName') continue;
      const v = Number(it[k]);
      if (!isNaN(v)) s += v;
    }
  }
  return s;
}

async function fetchOp(op, code, ym) {
  const url = `${BASE}/${op}?serviceKey=${encodeURIComponent(KEY)}&kaptCode=${code}&searchDate=${ym}&_type=json`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const j = JSON.parse(await r.text());
    return sumItem(j && j.response && j.response.body && j.response.body.item);
  } catch (e) { return 0; }
}

// 데이터 있는 최신 월 찾기(청소비 항목으로 프로브). 없으면 null.
async function findYm(code) {
  const now = new Date();
  for (let back = 2; back <= 13; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const v = await fetchOp('getHsmpCleaningCostInfoV2', code, ym);
    if (v > 0) return ym;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store'); // Supabase가 캐시 담당

  const code = req.query.code;
  const units = parseInt(req.query.units) || 0;
  if (!code) return res.status(400).json({ error: 'code 필요' });

  // 1) 캐시 확인
  const cached = await readCache(code);
  if (cached) {
    return res.status(200).json({
      cached: true, ym: cached.ym, total: cached.total,
      perHousehold: cached.per_hshld, detail: cached.detail || [],
      units, empty: !cached.total,
    });
  }

  // 2) 데이터 있는 최신 월 찾기
  const ym = await findYm(code);
  if (!ym) {
    // 관리비 공개 대상 아님/데이터 없음 → 빈 결과도 캐시해 재프로브 방지
    writeCache(code, '', 0, 0, []);
    return res.status(200).json({ ym: null, total: 0, perHousehold: 0, detail: [], units, empty: true });
  }

  // 3) 17개 항목 병렬 수집
  const results = await Promise.all(OPS.map(async ([op, label]) => {
    const amount = await fetchOp(op, code, ym);
    return { label, amount };
  }));
  const total  = results.reduce((s, x) => s + x.amount, 0);
  const detail = results.filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
  const per    = units > 0 ? Math.round(total / units) : 0;

  writeCache(code, ym, total, per, detail);
  return res.status(200).json({ cached: false, ym, total, perHousehold: per, detail, units, empty: total === 0 });
}
