// =============================================================
//  아구구 검색용(SEO) 단지 페이지 생성기  — 실데이터 버전
//  "OO아파트 관리사무소 전화번호·실거래가" 검색을 잡는 도어웨이 페이지.
//  정보를 실제로 보여주고(전화번호·기본정보) + 광고 + "지도에서 보기"로 앱 유입.
//
//  입력: split_output/coords_apt_*.json (단지 기본정보) + split_output/kapt_tel.json (전화번호)
//  출력: apt/{code}.html + sitemap.xml   (기본 위치, OUT_DIR로 변경 가능)
//  실행(전체):    node scripts/build_seo_pages.js
//  실행(미리보기): OUT_DIR=폴더 ONLY_WITH_TEL=1 LIMIT=30 node scripts/build_seo_pages.js
// =============================================================
const fs = require('fs');
const path = require('path');

const BASE = 'https://a99.co.kr';                 // 검색 canonical (실서비스 도메인)
const MAP  = 'https://a99.co.kr';                 // 지도 앱
const SPLIT = path.join(__dirname, '..', 'split_output');
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'apt');
const ONLY_WITH_TEL = process.env.ONLY_WITH_TEL === '1';   // 미리보기: 전화번호 있는 단지만
const LIMIT = Number(process.env.LIMIT || 0);             // 0=전체

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 전화번호 표시 포맷 (저장값이 숫자만이든 형식이든 041-XXX-XXXX 식으로 통일)
function fmtTel(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/[^0-9]/g, ''); if (!d) return '';
  if (d.startsWith('82')) d = '0' + d.slice(2);
  if (d.length === 8 && /^1[568]/.test(d)) return d.slice(0, 4) + '-' + d.slice(4);
  const area = d.startsWith('02') ? 2 : 3, a = d.slice(0, area), rest = d.slice(area);
  if (rest.length === 8) return a + '-' + rest.slice(0, 4) + '-' + rest.slice(4);
  if (rest.length === 7) return a + '-' + rest.slice(0, 3) + '-' + rest.slice(3);
  if (rest.length > 4) return a + '-' + rest.slice(0, rest.length - 4) + '-' + rest.slice(-4);
  if (rest.length === 4) return a + '-' + rest;
  return d;
}

// 전화번호 로드 (TEL_FILE로 경로 변경 가능 = 미리보기용)
let TEL = {};
try { TEL = JSON.parse(fs.readFileSync(process.env.TEL_FILE || path.join(SPLIT, 'kapt_tel.json'), 'utf8')); } catch (e) {}

// 단지 로드 (전국)
function loadApts() {
  const out = [], seen = new Set();
  for (const f of fs.readdirSync(SPLIT)) {
    if (!/^coords_apt_\d+\.json$/.test(f)) continue;
    try {
      for (const a of JSON.parse(fs.readFileSync(path.join(SPLIT, f), 'utf8'))) {
        if (a && a.code && !seen.has(a.code)) { seen.add(a.code); out.push(a); }
      }
    } catch (e) {}
  }
  return out;
}

function page(a) {
  const tel = fmtTel((TEL[a.code] && TEL[a.code].tel) || '');
  const region = [a.sido, a.sigungu, a.emd].filter(Boolean).join(' › ');
  const builtY = a.built ? String(a.built).slice(0, 4) : '';
  const title = a.name + ' 관리사무소 전화번호·실거래가·단지정보 | 아구구';
  const desc = [a.sido, a.sigungu, a.emd, a.name].filter(Boolean).join(' ')
    + ' 관리사무소 전화번호' + (tel ? '(' + tel + ')' : '') + ', 실거래가, 세대수 ' + (a.units || '-') + '세대, '
    + (builtY ? builtY + '년 준공, ' : '') + '주소 등 단지 정보를 아구구에서 확인하세요.';
  const url = BASE + '/apt/' + a.code;

  const telBlock = tel
    ? '<a class="tel" href="tel:' + tel.replace(/-/g, '') + '">📞 ' + tel + '</a><div class="tel-sub">관리사무소</div>'
    : '<div class="tel-none">관리사무소 전화번호 준비 중</div>';

  const facts = [
    ['세대수', a.units ? a.units + '세대' : '-'],
    ['준공', builtY ? builtY + '년' : '-'],
    ['최고층', a.topFloor ? a.topFloor + '층' : '-'],
    ['동수', a.dongCnt || '-'],
    ['난방', a.heat || '-'],
    ['총주차', a.totalPark ? Number(a.totalPark).toLocaleString() + '대' : '-'],
    ['시공사', a.builder || '-'],
    ['관리방식', a.mgrType || '-'],
  ].map(x => '<div class="cell"><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>').join('');

  return '<!DOCTYPE html><html lang="ko"><head>'
+ '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
+ '<title>' + esc(title) + '</title>'
+ '<meta name="description" content="' + esc(desc) + '">'
+ '<link rel="canonical" href="' + url + '">'
+ '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(a.name) + ' 관리사무소 전화번호·실거래가 | 아구구">'
+ '<meta property="og:description" content="' + esc(desc) + '"><meta property="og:url" content="' + url + '"><meta property="og:site_name" content="아구구 a99">'
+ '<style>'
+ '*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,\'Malgun Gothic\',sans-serif;background:#f5f7fa;color:#1a1a1a;line-height:1.5}'
+ '.wrap{max-width:640px;margin:0 auto;background:#fff;min-height:100vh}'
+ 'header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee}'
+ '.logo{font-weight:800;font-size:18px;color:#16a34a}.logo span{color:#1a1a1a}'
+ '.bc{font-size:12px;color:#888;padding:10px 16px 0}.hero{padding:6px 16px 16px}'
+ '.badge{display:inline-block;background:#f0fdf4;color:#16a34a;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;margin-bottom:8px}'
+ 'h1{font-size:22px;font-weight:800}.addr{color:#666;font-size:13px;margin-top:4px}'
+ '.telbox{margin:14px 0;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;text-align:center}'
+ '.tel{display:inline-block;font-size:24px;font-weight:800;color:#15803d;text-decoration:none}'
+ '.tel-sub{font-size:12px;color:#16a34a;margin-top:2px}.tel-none{color:#999;font-size:14px}'
+ '.cta{display:block;width:100%;background:#16a34a;color:#fff;text-align:center;font-weight:700;font-size:16px;padding:15px;border-radius:12px;text-decoration:none;box-shadow:0 4px 12px rgba(22,163,74,.3)}'
+ '.cta small{display:block;font-weight:400;font-size:12px;opacity:.9;margin-top:2px}'
+ '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#eee;border-top:1px solid #eee;border-bottom:1px solid #eee}'
+ '.cell{background:#fff;padding:12px 6px;text-align:center}.cell .k{font-size:11px;color:#999}.cell .v{font-size:13px;font-weight:700;margin-top:3px}'
+ 'section{padding:18px 16px;border-bottom:8px solid #f5f7fa}h2{font-size:15px;font-weight:800;margin-bottom:10px}'
+ '.info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:14px}.info-row .k{color:#888}.info-row .v{font-weight:600;text-align:right}'
+ '.ad{margin:0 16px 14px;border-radius:12px;padding:12px;text-align:center;font-size:11px}'
+ '.adA{background:linear-gradient(90deg,#fff7ed,#ffedd5);border:1.5px dashed #fdba74;color:#c2410c}'
+ '.adB{background:#fafbfc;border:1.5px dashed #cbd5e1;color:#94a3b8}'
+ 'footer{padding:18px 16px 40px;font-size:11px;color:#aaa;text-align:center}'
+ '.side-ad{display:none}@media(min-width:1040px){.side-ad{display:block;position:fixed;top:50%;left:calc(50% + 340px);transform:translateY(-50%);z-index:50}}'
+ '</style></head><body><div class="wrap">'
+ '<header><div class="logo">a99 <span>아구구</span></div><div style="font-size:13px;color:#16a34a;font-weight:700">🗺️ 지도</div></header>'
+ '<div class="bc">' + esc(region) + ' › <b style="color:#555">' + esc(a.name) + '</b></div>'
+ '<div class="hero">'
+ '<span class="badge">아파트 단지정보</span>'
+ '<h1>' + esc(a.name) + '</h1>'
+ '<div class="addr">' + esc(a.addr || a.jibunAddr || '') + '</div>'
+ '<div class="telbox">' + telBlock + '</div>'
+ '<a class="cta" href="' + MAP + '/?apt=' + a.code + '">🗺️ 아구구 지도에서 실거래가·시세 보기<small>매매·전세 실거래 추이 · 주변 학교·매물 문의</small></a>'
+ '</div>'
+ '<div class="grid">' + facts + '</div>'
+ '<div class="ad adA">' + esc(a.emd || a.sigungu || '') + ' 지역 광고 자리 (이사·청소·인테리어)</div>'
+ '<section><h2>📍 주소 · 기본정보</h2>'
+ '<div class="info-row"><span class="k">도로명주소</span><span class="v">' + esc(a.addr || '-') + '</span></div>'
+ '<div class="info-row"><span class="k">단지분류</span><span class="v">' + esc(a.aptType || '아파트') + '</span></div>'
+ '<div class="info-row"><span class="k">현관구조</span><span class="v">' + esc(a.entrance || '-') + '</span></div>'
+ '</section>'
+ '<div class="side-ad"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="DAN-6hzBUhx1qcJKOIsS" data-ad-width="160" data-ad-height="600"></ins></div>'
+ '<div style="text-align:center;padding:14px 16px 4px"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="DAN-VVNFKrpvthFpw6PS" data-ad-width="300" data-ad-height="250"></ins></div><script type="text/javascript" src="//t1.kakaocdn.net/kas/static/ba.min.js" async></script>'
+ '<div class="hero"><a class="cta" href="' + MAP + '/?apt=' + a.code + '">🗺️ 지도에서 자세히 보기<small>실거래가 · 주변 단지 비교 · 협력 중개사에게 집내놓기</small></a></div>'
+ '<footer>공공데이터 기반 참고용 정보이며 실제와 차이가 있을 수 있습니다.<br><a href="/privacy" style="color:#16a34a;text-decoration:none">개인정보처리방침</a> · <a href="/terms" style="color:#16a34a;text-decoration:none">이용약관</a><br>아구구 a99 © 2026</footer>'
+ '</div></body></html>';
}

// 실행
let apts = loadApts();
if (process.env.SGG) { const p = String(process.env.SGG).trim(); apts = apts.filter(a => String(a.sigunguCode || '').startsWith(p)); } // 지역 필터: 시군구코드 앞자리 (충남=44, 아산=44200)
if (ONLY_WITH_TEL) apts = apts.filter(a => TEL[a.code] && TEL[a.code].tel);
if (LIMIT > 0) apts = apts.slice(0, LIMIT);

fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const a of apts) { fs.writeFileSync(path.join(OUT, a.code + '.html'), page(a)); n++; }

const _today = new Date().toISOString().slice(0, 10);
const urls = apts.map(a => '  <url><loc>' + BASE + '/apt/' + a.code + '</loc><lastmod>' + _today + '</lastmod><changefreq>weekly</changefreq></url>').join('\n');
fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n');

const withTel = apts.filter(a => TEL[a.code] && TEL[a.code].tel).length;
console.log('생성 완료: ' + n + '개 페이지 -> ' + OUT);
console.log('  전화번호 표시: ' + withTel + '개 (나머지는 준비중, 수집 끝나면 재실행하면 채워짐)');
console.log('  sitemap.xml 포함');
