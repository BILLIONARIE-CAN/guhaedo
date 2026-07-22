// =============================================================
//  사이트맵 생성기 (검색 색인용)
//  - apt/sitemap.xml       : 단지 상세 2만여 개 + lastmod
//  - sitemap-main.xml      : 홈/개인정보/약관 + lastmod
//  - sitemap.xml (root)    : 위 둘을 묶는 사이트맵 인덱스
//  실행: node scripts/build_sitemap.js
//  robots.txt 는 root sitemap.xml 을 가리켜야 함.
// =============================================================
const fs = require('fs');
const path = require('path');

const BASE = 'https://a99.co.kr';
const ROOT = path.join(__dirname, '..');
const APTS = require(path.join(ROOT, 'split_output', 'coords_all_apt.json'));
const today = new Date().toISOString().slice(0, 10);

// 1) 단지 사이트맵 (lastmod 포함)
const seen = new Set();
const aptUrls = [];
for (const a of APTS) {
  if (a && a.code && !seen.has(a.code)) {
    seen.add(a.code);
    aptUrls.push('  <url><loc>' + BASE + '/apt/' + a.code + '</loc><lastmod>' + today + '</lastmod><changefreq>weekly</changefreq></url>');
  }
}
fs.writeFileSync(path.join(ROOT, 'apt', 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + aptUrls.join('\n') + '\n</urlset>\n');

// 2) 메인 페이지 사이트맵
const mainPages = [
  ['/', '1.0', 'daily'],
  ['/privacy', '0.3', 'yearly'],
  ['/terms', '0.3', 'yearly'],
];
const mainUrls = mainPages.map(function (p) {
  return '  <url><loc>' + BASE + p[0] + '</loc><lastmod>' + today + '</lastmod><changefreq>' + p[2] + '</changefreq><priority>' + p[1] + '</priority></url>';
});
fs.writeFileSync(path.join(ROOT, 'sitemap-main.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + mainUrls.join('\n') + '\n</urlset>\n');

// 3) 사이트맵 인덱스 (root) — 하위 사이트맵을 묶음(스코프 제한 해제)
const index = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + '  <sitemap><loc>' + BASE + '/sitemap-main.xml</loc><lastmod>' + today + '</lastmod></sitemap>\n'
  + '  <sitemap><loc>' + BASE + '/apt/sitemap.xml</loc><lastmod>' + today + '</lastmod></sitemap>\n'
  + '</sitemapindex>\n';
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), index);

console.log('생성 완료:');
console.log('  apt/sitemap.xml     : ' + aptUrls.length + '개 (lastmod ' + today + ')');
console.log('  sitemap-main.xml    : ' + mainUrls.length + '개');
console.log('  sitemap.xml (index) : 2개 하위 사이트맵');
