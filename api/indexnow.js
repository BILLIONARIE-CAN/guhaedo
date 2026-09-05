// =============================================================
//  IndexNow 즉시 색인 제출 엔드포인트 (네이버·빙·야후 등)
//  방문: /api/indexnow?secret=<KEY>[&limit=N]
//  - 전체 단지 + 홈/약관 URL을 IndexNow API에 배치 제출(배치당 최대 1만)
//  - secret 없으면 403 (남용 방지). secret = 인증키와 동일.
//  구글은 IndexNow 미지원 → 사이트맵+서치콘솔로 커버.
// =============================================================
const APTS = require('../split_output/coords_all_apt.json');

const KEY = '3c4fc034da972bac20f024ef003bf1ec';
const HOST = 'a99.co.kr';
const BASE = 'https://a99.co.kr';

module.exports = async (req, res) => {
  const q = req.query || {};
  if ((q.secret || '') !== KEY) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('forbidden');
    return;
  }
  const limit = parseInt(q.limit, 10) || 0;

  // 제출 URL 목록 구성 (홈/약관 + 전 단지)
  const seen = new Set();
  const urls = [BASE + '/', BASE + '/about', BASE + '/contact', BASE + '/privacy', BASE + '/terms', BASE + '/rank', BASE + '/region'];
  for (const a of APTS) {
    if (a && a.code && !seen.has(a.code)) { seen.add(a.code); urls.push(BASE + '/apt/' + a.code); }
  }
  const list = limit > 0 ? urls.slice(0, limit) : urls;

  // 배치 제출 (IndexNow 배치당 최대 10,000 URL)
  const results = [];
  for (let i = 0; i < list.length; i += 10000) {
    const batch = list.slice(i, i + 10000);
    const body = JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: BASE + '/' + KEY + '.txt',
      urlList: batch,
    });
    try {
      const r = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      });
      results.push({ batch: batch.length, status: r.status });
    } catch (e) {
      results.push({ batch: batch.length, error: String(e) });
    }
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ submitted: list.length, batches: results }, null, 2));
};
