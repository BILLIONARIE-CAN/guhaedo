// =============================================================
//  단지 검색 API  -  /api/search?sido={시도}&q={이름 또는 초성}
//  coords_all_apt.json에서 시도 + 이름(또는 초성)으로 필터 → 상위 15개
//  초성 검색 지원: "ㅎㅅㅌㅇㅌ" → 힐스테이트
//  (단지페이지 검색란이 이 API만 호출 → 페이지는 가볍게 유지)
// =============================================================
const APTS = require('../split_output/coords_all_apt.json');

// 초성 19자
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function chosungOf(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xAC00 && c <= 0xD7A3) out += CHO[Math.floor((c - 0xAC00) / 588)];
    else out += str[i];
  }
  return out;
}
// 쿼리가 초성으로만 이뤄졌는지 (ㄱ~ㅎ 자음만)
function isChosungQuery(s) {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) if (CHO.indexOf(s[i]) < 0) return false;
  return true;
}

// 가벼운 검색 인덱스 (콜드스타트 1회) — 이름 초성 미리 계산
const IDX = [];
for (const a of APTS) {
  if (a && a.code && a.name) {
    IDX.push({
      code: a.code, name: a.name, sido: a.sido || '', sigungu: a.sigungu || '', emd: a.emd || '',
      cho: chosungOf(a.name.replace(/\s/g, ''))
    });
  }
}

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');

  const sido = ((req.query && req.query.sido) || '').trim();
  const sgg = ((req.query && req.query.sgg) || '').trim();
  const q = ((req.query && req.query.q) || '').trim();
  if (!q) { res.end('[]'); return; }

  let pool = IDX;
  if (sido) pool = pool.filter(a => a.sido === sido);
  if (sgg) pool = pool.filter(a => a.sigungu === sgg);
  const nq = q.replace(/\s/g, '');
  const choMode = isChosungQuery(nq);

  // 랭킹: 시작일치(0) > 포함(1) > 읍면동(2), 동점이면 이름 짧은 순
  const scored = [];
  for (const a of pool) {
    let score = -1;
    if (choMode) {
      const pos = a.cho.indexOf(nq);
      if (pos === 0) score = 0;
      else if (pos > 0) score = 1;
    } else {
      const nm = a.name.replace(/\s/g, '');
      const pos = nm.indexOf(nq);
      if (pos === 0) score = 0;
      else if (pos > 0) score = 1;
      else if (a.emd && a.emd.indexOf(q) >= 0) score = 2;
    }
    if (score >= 0) scored.push({ a: a, score: score });
  }
  scored.sort((x, y) => (x.score - y.score) || (x.a.name.length - y.a.name.length));

  const map = s => ({ code: s.a.code, name: s.a.name, sido: s.a.sido, sigungu: s.a.sigungu, emd: s.a.emd });
  const page = parseInt(req.query.page) || 0;
  if (page > 0) {
    // 페이지네이션 모드: {total, page, size, items}
    const size = Math.min(Math.max(parseInt(req.query.size) || 20, 1), 50);
    const start = (page - 1) * size;
    res.end(JSON.stringify({ total: scored.length, page: page, size: size, items: scored.slice(start, start + size).map(map) }));
  } else {
    // 자동완성 모드(SEO 페이지): 상위 25개 배열
    res.end(JSON.stringify(scored.slice(0, 25).map(map)));
  }
};
