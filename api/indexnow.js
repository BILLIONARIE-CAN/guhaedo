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

  // 제출 URL 목록 구성 (홈/약관 + 단지)
  // ⚠️ 단지 목록은 coords 파일이 아니라 **우리 사이트맵을 읽어서** 만든다.
  //    2026-10 시세 없는 2,780개에 noindex 를 걸었는데, 여기서 coords 를
  //    그대로 쓰면 매주 네이버·빙에 "가져가라" 해놓고 가보면 "색인하지 마라" 가
  //    붙어있는 꼴이 된다. 색인시킬 목록은 사이트맵 하나로 통일한다.
  const seen = new Set();
  const urls = [BASE + '/', BASE + '/about', BASE + '/contact', BASE + '/privacy', BASE + '/terms', BASE + '/rank', BASE + '/region'];
  let fromSitemap = 0;
  try {
    const sm = await fetch(BASE + '/apt-sitemap.xml', { signal: AbortSignal.timeout(15000) });
    if (sm.ok) {
      const xml = await sm.text();
      const re = /<loc>([^<]+)<\/loc>/g;
      let mm;
      while ((mm = re.exec(xml))) {
        const u = mm[1];
        if (!seen.has(u)) { seen.add(u); urls.push(u); fromSitemap++; }
      }
    }
  } catch (e) { /* 아래 폴백 */ }
  // 폴백: 사이트맵을 못 읽었거나 너무 적게 받았으면 예전처럼 coords 전체를 쓴다.
  if (fromSitemap < 5000) {
    for (const a of APTS) {
      const u = BASE + '/apt/' + (a && a.code);
      if (a && a.code && !seen.has(u)) { seen.add(u); urls.push(u); }
    }
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
