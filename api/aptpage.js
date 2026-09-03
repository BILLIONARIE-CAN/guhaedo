// =============================================================
//  전국 단지 검색페이지 - 서버 즉석 생성(serverless)
//  요청: /apt/{코드}  (vercel.json rewrite → /api/aptpage?code={코드})
//  데이터: split_output/coords_all_apt.json (전국) + kapt_tel.json (전화번호)
//  → 파일 2만개 안 만들고 페이지 2만개를 서버가 그때그때 렌더링
// =============================================================
const APTS = require('../split_output/coords_all_apt.json');
let INFO = {};
try { INFO = require('../split_output/kapt_info.json'); } catch (e) {
  // 구버전 폴백: kapt_tel.json
  try { INFO = require('../split_output/kapt_tel.json'); } catch (e2) {}
}

// code → 단지 조회용 Map (콜드스타트 1회, 이후 warm 캐시)
const BY_CODE = new Map();
for (const a of APTS) if (a && a.code) BY_CODE.set(a.code, a);

// 시군구별 그룹 (주변 단지 내부링크용) — 콜드스타트 1회
const BY_SGG = new Map();
for (const a of APTS) {
  if (!a || !a.code) continue;
  const k = a.sigunguCode || (a.sido + '|' + a.sigungu);
  if (!BY_SGG.has(k)) BY_SGG.set(k, []);
  BY_SGG.get(k).push(a);
}

const BASE = 'https://a99.co.kr';
const MAP = 'https://a99.co.kr';
const SUPABASE_URL = 'https://nqnbbccazjanjhktknyz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbmJiY2Nhemphbmpoa3Rrbnl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0OTA5NDQsImV4cCI6MjA5NTA2Njk0NH0.rT_hIwTJyBnCDGyudmJYvN44G67WgZ9-bSVCzShiRjI';
const AD_UNIT = 'DAN-VVNFKrpvthFpw6PS'; // 애드핏 광고단위(300x250, 하단)
const AD_UNIT_SIDE = 'DAN-6hzBUhx1qcJKOIsS'; // 애드핏 광고단위(160x600, PC 우측 사이드)
const AD_UNIT_SIDE_L = 'DAN-A9WnwICFDEl16jU1'; // 애드핏 광고단위(160x600, PC 좌측 사이드)
const AD_UNIT_TOP = 'DAN-MS50ssMpQLYwDL5r'; // 애드핏 광고단위(320x100, 최상단 얇은 배너 — 320x100 재사용, 나중에 PC 728x90 분기 가능)
const SIDO_LIST = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도'];
// 도 → 시군구 목록 (콜드스타트 1회 계산, 페이지 스크립트에 주입 → 도 선택 시 시군구 자동 채움)
const SGG_BY_SIDO = (function () {
  const m = {};
  for (const a of APTS) if (a && a.sido && a.sigungu) { (m[a.sido] = m[a.sido] || new Set()).add(a.sigungu); }
  const o = {}; for (const k in m) o[k] = Array.from(m[k]).sort();
  return o;
})();
const SGG_JSON = JSON.stringify(SGG_BY_SIDO);

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

// 주변 단지 내부링크 (같은 동 우선 → 같은 시군구) — 크롤러 순회·색인 가속 + 키워드 앵커
function nearbyLinks(a) {
  const k = a.sigunguCode || (a.sido + '|' + a.sigungu);
  const pool = BY_SGG.get(k) || [];
  const sameEmd = [], sameSgg = [];
  for (const b of pool) {
    if (!b || !b.code || b.code === a.code) continue;
    if (a.emd && b.emd === a.emd) sameEmd.push(b); else sameSgg.push(b);
  }
  const list = sameEmd.concat(sameSgg).slice(0, 12);
  if (!list.length) return '';
  const items = list.map(b =>
    '<li><a href="/apt/' + b.code + '">' + esc(b.name) + ' 관리사무소 전화번호</a></li>').join('');
  const label = esc(a.emd || a.sigungu || '') + ' 주변 아파트 단지';
  // 지역 허브 + 랭킹으로 가는 내부링크. 단지페이지 2만여 개가 랭킹을 가리켜 색인을 끌어올림.
  const sido2 = String(a.sigunguCode || '').slice(0, 2);
  const sidoNm = (typeof SIDO2 !== 'undefined' && SIDO2[sido2]) ? SIDO2[sido2] : '';
  const rankLink = sidoNm
    ? ' · <a href="/rank/py/' + sido2 + '" style="font-size:13px;color:#15803d;font-weight:600">' + esc(sidoNm) + ' 평당가 순위</a>'
    : ' · <a href="/rank" style="font-size:13px;color:#15803d;font-weight:600">아파트 랭킹</a>';
  const hubLink = '<div style="margin-top:10px"><a href="/region/' + encodeURIComponent(k) + '" style="font-size:13px;color:#15803d;font-weight:600">→ ' + esc(a.sigungu || a.sido || '') + ' 아파트 단지 전체 보기</a>' + rankLink + '</div>';
  return '<section class="nearby"><h2>🏢 ' + label + '</h2><ul class="nearby-list">' + items + '</ul>' + hubLink + '</section>';
}

// 평형대별 관리비 추정 섹션
// avgFee: 세대당 월 평균 관리비(원), useArea: 총 전용면적(㎡), units: 세대수
// areaBreak: { u60, u85, u135, o135 } — 각 구간 세대 수
function feeSection(avgFee, useArea, units, areaBreak) {
  if (!avgFee || !useArea || !units) return '';
  const sqmPrice = avgFee * Number(units) / Number(useArea); // 원/㎡
  if (!sqmPrice || sqmPrice < 100 || sqmPrice > 20000) return ''; // 비정상 데이터 제외

  // 평형대 대표 면적 (구간별 중앙값 기준)
  const bands = [
    { key: 'u60',  label: '20평 이하', rep: 49  },
    { key: 'u85',  label: '25평형대',  rep: 84  },
    { key: 'u135', label: '33평형대',  rep: 110 },
    { key: 'o135', label: '40평형 이상', rep: 150 },
  ];
  const ab = areaBreak || {};
  const rows = bands
    .filter(b => ab[b.key] > 0)
    .map(b => {
      const est = Math.round(sqmPrice * b.rep / 10000); // 만원 단위 반올림
      return '<div class="fee-row">'
        + '<span class="fee-py">' + b.label + '<small> (' + b.rep + '㎡)</small></span>'
        + '<span class="fee-amt">약 ' + est + '만원</span>'
        + '</div>';
    }).join('');

  if (!rows) return '';
  const sqmStr = Math.round(sqmPrice).toLocaleString();
  return '<section>'
    + '<h2>💰 관리비 추정 <small style="font-size:11px;font-weight:400;color:#999">(K-apt 기준, ㎡당 ' + sqmStr + '원)</small></h2>'
    + '<div class="fee-box">' + rows + '</div>'
    + '<p style="font-size:11px;color:#aaa;margin-top:6px">* 단지 평균 기준 추정치. 사용량·타입에 따라 실제와 다를 수 있어요.</p>'
    + '</section>';
}

// 단지 소개 문단(단지마다 고유 본문 → 얇은 페이지 보강)
function introText(a, tel) {
  const region = [a.sido, a.sigungu, a.emd].filter(Boolean).join(' ');
  const y = a.built ? String(a.built).slice(0, 4) : '';
  const p = [];
  p.push('<b>' + esc(a.name) + '</b>은(는) ' + esc(region) + '에 위치한'
    + (a.units ? ' ' + esc(String(a.units)) + '세대' : '') + ' 규모의 ' + esc(a.aptType || '아파트') + ' 단지입니다.');
  if (y) p.push(esc(y) + '년에 준공되었으며' + (a.builder ? ', 시공사는 ' + esc(a.builder) + '입니다.' : '.'));
  const scale = [a.dongCnt ? esc(a.dongCnt) : '', a.topFloor ? '최고 ' + esc(String(a.topFloor)) + '층' : ''].filter(Boolean).join(', ');
  if (scale) p.push('단지 규모는 ' + scale + '이며' + (a.heat ? ' 난방방식은 ' + esc(a.heat) + '입니다.' : '입니다.'));
  p.push(tel ? ('관리사무소 전화번호는 ' + esc(tel) + '이며, 아래에서 실거래가·관리비·단지정보를 확인할 수 있습니다.')
             : '아래에서 관리사무소 전화번호·실거래가·관리비·단지정보를 확인할 수 있습니다.');
  return '<p class="intro">' + p.join(' ') + '</p>';
}
// FAQ 섹션 + FAQPage 구조화데이터(리치 결과 노출 유도)
function faqSection(a, tel, fax, m) {
  const nm = esc(a.name), y = a.built ? String(a.built).slice(0, 4) : '';
  const qa = [];
  if (m && m.price_m) qa.push([nm + ' 실거래가는 얼마인가요?', nm + (m.rep_area_m2 ? ' 대표 ' + Math.round(m.rep_area_m2) + '㎡' : '') + ' 최근 실거래가는 약 ' + wonMan(m.price_m) + '입니다.' + (m.py_m ? ' 평당 약 ' + Number(m.py_m).toLocaleString() + '만원' : '') + (m.jeonse_m ? ', 전세 약 ' + wonMan(m.jeonse_m) : '') + '. (국토부 공개 실거래가 기준)']);
  if (tel) qa.push([nm + ' 관리사무소 전화번호는 몇 번인가요?', nm + ' 관리사무소 전화번호는 ' + esc(tel) + '입니다.' + (fax ? ' 팩스번호는 ' + esc(fax) + '입니다.' : '')]);
  if (a.units) qa.push([nm + '은(는) 몇 세대인가요?', nm + '은(는) 총 ' + esc(String(a.units)) + '세대입니다.']);
  if (y) qa.push([nm + '의 준공 연도는 언제인가요?', nm + '은(는) ' + esc(y) + '년에 준공되었습니다.']);
  if (a.builder) qa.push([nm + '의 시공사는 어디인가요?', nm + '의 시공사는 ' + esc(a.builder) + '입니다.']);
  qa.push([nm + ' 관리비는 얼마인가요?', nm + '의 세대당 월 공용관리비는 이 페이지의 관리비 항목에서 확인할 수 있습니다. (K-apt 공개자료 기준)']);
  if (a.addr) qa.push([nm + '의 주소는 어디인가요?', nm + '의 도로명주소는 ' + esc(a.addr) + '입니다.']);
  const strip = s => s.replace(/<[^>]+>/g, '');
  const html = '<section class="faq"><h2>❓ ' + nm + ' 자주 묻는 질문</h2>'
    + qa.map(x => '<details class="faq-item"><summary>' + x[0] + '</summary><div class="faq-a">' + x[1] + '</div></details>').join('')
    + '</section>';
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(x => ({ '@type': 'Question', name: strip(x[0]), acceptedAnswer: { '@type': 'Answer', text: strip(x[1]) } })) };
  return html + '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
}
// 만원 → "3억 5,000만원"
function wonMan(man){man=Math.round(Number(man)||0);if(man===0)return '-';var neg=man<0;man=Math.abs(man);var e=Math.floor(man/10000),r=man%10000;var s=e?e+'억':'';if(r)s+=(e?' ':'')+r.toLocaleString()+'만';return (neg?'-':'')+s+'원';}  // 음수=역전세(전세>매매). 예전엔 <=0을 '-'로 지워서 역전세가 안 보였음
// apt_metrics 단건 조회 (렌더당 1회 — 페이지 CDN 1일 캐시라 부담 없음)
async function fetchMetrics(code){
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/apt_metrics?kapt_code=eq.'+encodeURIComponent(code)+'&select=rep_area_m2,price_m,py_m,jeonse_m,j_rate,gap_m,deal_cnt',{headers:{apikey:SUPABASE_ANON,Authorization:'Bearer '+SUPABASE_ANON},signal:AbortSignal.timeout(2500)});
    const rows=await r.json();
    return Array.isArray(rows)&&rows[0]&&rows[0].price_m?rows[0]:null;
  }catch(e){return null;}
}
// 실거래·시세 섹션 — 실제 숫자를 서버 HTML에 박아 색인·검색노출 강화
function saleSection(m){
  if(!m||!m.price_m) return '';
  const py=m.rep_area_m2?Math.round(m.rep_area_m2/0.75/3.3058*10)/10:0;
  const repArea=m.rep_area_m2?(Math.round(m.rep_area_m2)+'㎡'+(py?' ('+py+'평형)':'')):'';
  const rows=[['대표 매매가', wonMan(m.price_m)]];
  if(m.py_m) rows.push(['평당가', Number(m.py_m).toLocaleString()+'만원']);
  if(m.jeonse_m) rows.push(['대표 전세가', wonMan(m.jeonse_m)]);
  if(m.j_rate) rows.push(['전세가율', m.j_rate+'%']);
  if(m.gap_m!=null&&Number(m.gap_m)!==0) rows.push([Number(m.gap_m)<0?'매매·전세 갭 (역전세)':'매매·전세 갭', wonMan(m.gap_m)]);
  if(m.deal_cnt) rows.push(['최근 18개월 매매', m.deal_cnt+'건']);
  return '<section><h2>💹 실거래가·시세'+(repArea?' <small style="font-size:11px;font-weight:400;color:#16a34a">대표 '+repArea+' · 최근 18개월</small>':'')+'</h2>'
    + rows.map(r=>'<div class="info-row"><span class="k">'+esc(r[0])+'</span><span class="v">'+esc(r[1])+'</span></div>').join('')
    + '<div class="mgmt-note" style="margin-top:8px">※ 대표평형 최근 실거래 기준. 국토교통부 공개 실거래가 자료 기반이며 실제와 차이가 있을 수 있습니다.</div>'
    + '</section>';
}
function page(a, m) {
  const inf = INFO[a.code] || {};
  const tel = fmtTel(inf.tel || '');
  const fax = fmtTel(inf.fax || '');
  const region = [a.sido, a.sigungu, a.emd].filter(Boolean).join(' › ');
  const builtY = a.built ? String(a.built).slice(0, 4) : '';
  const title = a.name + ' 관리사무소 전화번호·실거래가·단지정보 | 아구구';
  const desc = [a.sido, a.sigungu, a.emd, a.name].filter(Boolean).join(' ')
    + ' 관리사무소 전화번호' + (tel ? '(' + tel + ')' : '') + ', 실거래가, 세대수 ' + (a.units || '-') + '세대, '
    + (builtY ? builtY + '년 준공, ' : '') + '주소 등 단지 정보'
    + (m && m.price_m ? '. 최근 실거래가 약 ' + wonMan(m.price_m) + (m.py_m ? '(평당 ' + Number(m.py_m).toLocaleString() + '만원)' : '') : '')
    + '를 아구구에서 확인하세요.';
  const url = BASE + '/apt/' + a.code;
  const telBlock = tel
    ? '<a class="tel" href="tel:' + tel.replace(/-/g, '') + '">📞 ' + tel + '</a><div class="tel-sub">관리사무소</div>'
      + (fax ? '<div class="fax">📠 ' + fax + '<span class="fax-lab"> 팩스</span></div>' : '')
    : '';
  const facts = [
    ['세대수', a.units ? a.units + '세대' : '-'],
    ['준공', builtY ? builtY + '년' : '-'],
    ['최고층', a.topFloor ? a.topFloor + '층' : '-'],
    ['동수', a.dongCnt || '-'],
    ['난방', a.heat || '-'],
    ['총주차', a.totalPark ? Number(a.totalPark).toLocaleString() + '대' : '-'],
    ['세대당 주차', (a.totalPark && a.units) ? (Number(a.totalPark) / Number(a.units)).toFixed(2) + '대' : '-'],
    ['시공사', a.builder || '-'],
    ['관리방식', a.mgrType || '-'],
  ].map(x => '<div class="cell"><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>').join('');

  const sidoOpts = '<option value="">전국</option>' + SIDO_LIST.map(s => '<option>' + s + '</option>').join('');
  const sggOpts = '<option value="">전체 시군구</option>';

  return '<!DOCTYPE html><html lang="ko"><head>'
+ '<script async src="https://www.googletagmanager.com/gtag/js?id=G-B2NJPFNP69"></script>'
+ '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'G-B2NJPFNP69\');</script>'
+ '<meta name="google-adsense-account" content="ca-pub-3915435017395988">'
+ '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3915435017395988" crossorigin="anonymous"></script>'
+ '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
+ '<title>' + esc(title) + '</title>'
+ '<meta name="description" content="' + esc(desc) + '">'
+ '<link rel="canonical" href="' + url + '">'
+ '<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/favicon-180.png">'
+ '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(a.name) + ' 관리사무소 전화번호·실거래가 | 아구구">'
+ '<meta property="og:description" content="' + esc(desc) + '"><meta property="og:url" content="' + url + '"><meta property="og:site_name" content="아구구">'
+ '<script type="application/ld+json">' + JSON.stringify({"@context":"https://schema.org","@type":"WebSite","name":"아구구","alternateName":"a99","url":BASE + '/'}).replace(/</g,'\\u003c') + '</script>'
+ '<script type="application/ld+json">' + JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"아구구","item":BASE + '/'},{"@type":"ListItem","position":2,"name":a.name + ' 관리사무소 전화번호','item':url}]}).replace(/</g,'\\u003c') + '</script>'
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
+ '.tel-sub{font-size:14px;font-weight:700;color:#16a34a;margin-top:2px}.tel-none{color:#999;font-size:14px}'
+ '.fax{margin-top:8px;padding-top:8px;border-top:1px dashed #bbf7d0;font-size:15px;font-weight:700;color:#15803d}.fax-lab{font-size:13px;font-weight:700;color:#16a34a}'
+ '.mgmt-box{margin:14px 0}.mgmt-load{padding:14px;color:#999;font-size:13px;text-align:center;background:#fafafa;border-radius:12px}'
+ '.mgmt{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px}.mgmt h2{font-size:16px;margin:0 0 10px}.mgmt h2 small{font-size:11px;font-weight:400;color:#16a34a;margin-left:4px}'
+ '.mgmt-avg{display:flex;justify-content:space-between;align-items:baseline;padding:10px 12px;background:#fff;border-radius:10px}.mgmt-avg span{font-size:13px;color:#444}.mgmt-avg b{font-size:22px;font-weight:800;color:#15803d}'
+ '.mgmt-det{margin-top:8px}.mgmt-det summary{cursor:pointer;font-size:13px;color:#15803d;font-weight:600;padding:6px 2px;list-style:revert}.mgmt-list{margin-top:4px;background:#fff;border-radius:10px;overflow:hidden}'
+ '.mgmt-row{display:flex;justify-content:space-between;padding:9px 12px;font-size:13px;border-bottom:1px solid #f0fdf4}.mgmt-row:last-child{border-bottom:none}.mgmt-row span:first-child{color:#555}.mgmt-row span:last-child{font-weight:600;color:#333}'
+ '.mgmt-note{margin-top:8px;font-size:11px;color:#9ca3af;line-height:1.5}'
+ '.intro{font-size:14px;line-height:1.75;color:#374151;margin:14px 0;padding:14px 16px;background:#fff;border:1px solid #eee;border-radius:12px}'
+ '.faq{margin:16px 0}.faq h2{font-size:16px;margin:0 0 8px}.faq-item{background:#fff;border:1px solid #eee;border-radius:10px;margin-bottom:8px;overflow:hidden}'
+ '.faq-item summary{cursor:pointer;padding:13px 15px;font-size:14px;font-weight:600;color:#1a1a1a;list-style:revert}.faq-a{padding:0 15px 14px;font-size:13px;line-height:1.7;color:#555}'
+ '.cta{display:block;width:100%;background:#16a34a;color:#fff;text-align:center;font-weight:700;font-size:16px;padding:15px;border-radius:12px;text-decoration:none;box-shadow:0 4px 12px rgba(22,163,74,.3)}'
+ '.cta small{display:block;font-weight:400;font-size:12px;opacity:.9;margin-top:2px}'
+ '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#eee;border-top:1px solid #eee;border-bottom:1px solid #eee}'
+ '.cell{background:#fff;padding:12px 6px;text-align:center}.cell .k{font-size:11px;color:#999}.cell .v{font-size:13px;font-weight:700;margin-top:3px}'
+ 'section{padding:18px 16px;border-bottom:8px solid #f5f7fa}h2{font-size:15px;font-weight:800;margin-bottom:10px}'
+ '.info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:14px}.info-row .k{color:#888}.info-row .v{font-weight:600;text-align:right}'
+ '.fee-box{border:1px solid #e8f5e9;border-radius:10px;overflow:hidden;margin-bottom:6px}'
+ '.fee-row{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #f0fdf4;font-size:14px}.fee-row:last-child{border-bottom:none}'
+ '.fee-py{color:#444}.fee-py small{color:#aaa;font-size:11px}.fee-amt{font-weight:600;color:#15803d}'
+ '.ad{margin:0 16px 14px;border-radius:12px;padding:12px;text-align:center;font-size:11px}'
+ '.adA{background:linear-gradient(90deg,#fff7ed,#ffedd5);border:1.5px dashed #fdba74;color:#c2410c}'
+ 'footer{padding:18px 16px 40px;font-size:11px;color:#aaa;text-align:center}'
+ '.nearby ul{list-style:none;margin:0;padding:0}.nearby li{border-bottom:1px solid #f5f5f5}.nearby a{display:block;padding:11px 2px;font-size:14px;color:#1a1a1a;text-decoration:none}.nearby a:hover{color:#16a34a}'
+ '.top-ad-bar{width:100%;background:#fff;border-bottom:1px solid #eee;text-align:center;padding:5px 0;line-height:0}.top-ad-bar ins{line-height:normal}'
+ '.side-ad{display:none}@media(min-width:1040px){.side-ad{display:block;position:fixed;top:50%;left:calc(50% + 340px);transform:translateY(-50%);z-index:50}}'
+ '.side-ad-l{display:none}@media(min-width:1040px){.side-ad-l{display:block;position:fixed;top:50%;left:calc(50% - 500px);transform:translateY(-50%);z-index:50}}'
+ '.sbar{position:relative;padding:12px 16px;background:#fff;border-bottom:1px solid #eee}'
+ '.srow{display:flex;gap:6px}.srow:first-child{margin-bottom:6px}'
+ '.sbar select{flex:1;min-width:0;padding:10px 6px;border:1px solid #ddd;border-radius:8px;font-size:13px;background:#fff}'
+ '.sbar input{flex:1;min-width:0;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px}'
+ '.sbar button{flex:0 0 auto;padding:10px 16px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}'
+ '.sug{position:absolute;top:100%;left:16px;right:16px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:60;max-height:320px;overflow:auto;display:none}'
+ '.sug.on{display:block}.sug-item{padding:11px 14px;border-bottom:1px solid #f3f4f6;cursor:pointer}.sug-item:hover{background:#f0fdf4}'
+ '.sug-item b{font-size:14px;font-weight:700}.sug-item span{display:block;font-size:11px;color:#999;margin-top:2px}.sug-none{padding:12px 14px;color:#999;font-size:13px}'
+ '.share-btn{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:6px 14px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}'
+ '.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:20px;font-size:13px;opacity:0;transition:.25s;pointer-events:none;z-index:100}.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}'
+ '</style></head><body>'
+ '<div class="top-ad-bar"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="' + AD_UNIT_TOP + '" data-ad-width="320" data-ad-height="100"></ins></div>'
+ '<div class="wrap">'
+ '<header><a href="/" class="logo" style="text-decoration:none;cursor:pointer">아구<span>구</span></a><button class="share-btn" onclick="shareApt()">공유</button></header>'
+ '<div class="sbar"><div class="srow"><select id="sido-sel">' + sidoOpts + '</select><select id="sgg-sel">' + sggOpts + '</select></div><div class="srow"><input id="apt-q" type="text" placeholder="아파트 이름·초성 검색" autocomplete="off"><button id="apt-go" type="button">검색</button></div><div id="sug" class="sug"></div></div>'
+ '<div class="bc">' + esc(region) + ' › <b style="color:#555">' + esc(a.name) + '</b></div>'
+ '<div class="hero">'
+ '<span class="badge">아파트 단지정보</span>'
+ '<h1>' + esc(a.name) + '</h1>'
+ '<div class="addr">' + esc(a.addr || a.jibunAddr || '') + '</div>'
+ (tel ? '<div class="telbox">' + telBlock + '</div>' : '')
+ '<a class="cta" href="' + MAP + '/?apt=' + a.code + '">🗺️ 아구구 지도에서 실거래가·시세 보기<small>매매·전세 실거래 추이 · 주변 학교·매물 문의</small></a>'
+ '</div>'
+ introText(a, tel)
+ '<div class="grid">' + facts + '</div>'
+ saleSection(m)
+ '<div id="mgmt-box" class="mgmt-box" data-code="' + a.code + '" data-units="' + (a.units || 0) + '"></div>'
+ '<div class="ad adA">' + esc(a.emd || a.sigungu || '') + ' 지역 광고 자리 (이사·청소·인테리어)</div>'
+ '<section><h2>📍 주소 · 기본정보</h2>'
+ '<div class="info-row"><span class="k">도로명주소</span><span class="v">' + esc(a.addr || '-') + '</span></div>'
+ '<div class="info-row"><span class="k">단지분류</span><span class="v">' + esc(a.aptType || '아파트') + '</span></div>'
+ '<div class="info-row"><span class="k">현관구조</span><span class="v">' + esc(a.entrance || '-') + '</span></div>'
+ '</section>'
+ faqSection(a, tel, fax, m)
+ nearbyLinks(a)
+ '<div class="side-ad"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="' + AD_UNIT_SIDE + '" data-ad-width="160" data-ad-height="600"></ins></div>'
+ '<div class="side-ad-l"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="' + AD_UNIT_SIDE_L + '" data-ad-width="160" data-ad-height="600"></ins></div>'
+ '<div style="text-align:center;padding:14px 16px 4px"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="' + AD_UNIT + '" data-ad-width="300" data-ad-height="250"></ins></div><script type="text/javascript" src="//t1.kakaocdn.net/kas/static/ba.min.js" async></script>'
+ '<div class="hero"><a class="cta" href="' + MAP + '/?apt=' + a.code + '">🗺️ 지도에서 자세히 보기<small>실거래가 · 주변 단지 비교 · 협력 중개사에게 집내놓기</small></a></div>'
+ '<footer>공공데이터 기반 참고용 정보이며 실제와 차이가 있을 수 있습니다.<br><a href="/privacy" style="color:#16a34a;text-decoration:none">개인정보처리방침</a> · <a href="/terms" style="color:#16a34a;text-decoration:none">이용약관</a><br>아구구 © 2026</footer>'
+ '</div>'
+ '<div id="toast" class="toast"></div>'
+ '<script>var SGG=' + SGG_JSON + ';function shareApt(){var d={title:document.title,url:location.href};if(navigator.share){navigator.share(d).catch(function(){});}else if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(location.href).then(function(){showToast("링크가 복사됐어요");},function(){fallbackCopy();});}else{fallbackCopy();}}function fallbackCopy(){var ta=document.createElement("textarea");ta.value=location.href;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");showToast("링크가 복사됐어요");}catch(e){showToast(location.href);}document.body.removeChild(ta);}function showToast(m){var t=document.getElementById("toast");if(!t)return;t.textContent=m;t.className="toast on";setTimeout(function(){t.className="toast";},1800);}(function(){var sido=document.getElementById("sido-sel"),sgg=document.getElementById("sgg-sel"),q=document.getElementById("apt-q"),go=document.getElementById("apt-go"),sug=document.getElementById("sug"),selCode="",t;'
+ 'function fillSgg(){var list=SGG[sido.value]||[];sgg.innerHTML="";var o0=document.createElement("option");o0.value="";o0.textContent="전체 시군구";sgg.appendChild(o0);for(var i=0;i<list.length;i++){var o=document.createElement("option");o.textContent=list[i];sgg.appendChild(o);}}'
+ 'function render(list){sug.innerHTML="";if(!list.length){var n=document.createElement("div");n.className="sug-none";n.textContent="검색 결과가 없어요";sug.appendChild(n);sug.className="sug on";return;}'
+ 'list.forEach(function(a){var it=document.createElement("div");it.className="sug-item";var b=document.createElement("b");b.textContent=a.name;it.appendChild(b);var s=document.createElement("span");s.textContent=a.sido+" "+a.sigungu+(a.emd?" "+a.emd:"");it.appendChild(s);it.onclick=function(){q.value=a.name;selCode=a.code;sug.className="sug";};sug.appendChild(it);});sug.className="sug on";}'
+ 'function doSearch(){var v=q.value.trim();if(!v){sug.className="sug";sug.innerHTML="";return;}fetch("/api/search?sido="+encodeURIComponent(sido.value)+"&sgg="+encodeURIComponent(sgg.value)+"&q="+encodeURIComponent(v)).then(function(r){return r.json();}).then(render).catch(function(){});}'
+ 'function goInfo(){if(selCode){location.href="/apt/"+selCode;}else{doSearch();}}'
+ 'sido.addEventListener("change",function(){fillSgg();selCode="";if(q.value.trim())doSearch();});'
+ 'sgg.addEventListener("change",function(){selCode="";if(q.value.trim())doSearch();});'
+ 'q.addEventListener("input",function(){selCode="";clearTimeout(t);t=setTimeout(doSearch,180);});'
+ 'go.addEventListener("click",goInfo);'
+ 'q.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();goInfo();}});'
+ 'document.addEventListener("click",function(e){if(!e.target.closest(".sbar")){sug.className="sug";}});'
+ '})();</script>'
+ '<script>(function(){var box=document.getElementById("mgmt-box");if(!box)return;var code=box.getAttribute("data-code"),units=box.getAttribute("data-units")||0;box.innerHTML=`<div class="mgmt-load">관리비 불러오는 중…</div>`;fetch("/api/apt?type=mgmtcost&code="+encodeURIComponent(code)+"&units="+units).then(function(r){return r.json();}).then(function(d){if(!d||d.empty||!d.perHousehold){box.innerHTML="";return;}var won=function(n){return (n||0).toLocaleString("ko-KR");};var ymTxt=d.ym?(d.ym.slice(0,4)+"."+d.ym.slice(4,6)):"";var rows=(d.detail||[]).map(function(x){return `<div class="mgmt-row"><span>${x.label}</span><span>${won(x.amount)}원</span></div>`;}).join("");box.innerHTML=`<section class="mgmt"><h2>💰 관리비 <small>공용관리비 · ${ymTxt} 기준</small></h2><div class="mgmt-avg"><span>세대당 월 공용관리비 (평균)</span><b>${won(d.perHousehold)}원</b></div>`+(rows?`<details class="mgmt-det"><summary>자세히 보기 · 단지 전체 월 ${won(d.total)}원</summary><div class="mgmt-list">${rows}</div></details>`:``)+`<div class="mgmt-note">※ 개별사용료(전기·수도·난방 등)·장기수선충당금은 제외한 공용관리비예요. K-apt 공개자료 기준.</div></section>`;}).catch(function(){box.innerHTML="";});})();</script>'
+ '</body></html>';
}

// ===== 지역 허브 페이지 (SEO 내부링크: /region, /region/{시군구코드}) =====
const SIDO_MAP = new Map(); // sido -> Map(sgCode -> {sigungu, count})
const SGG_INFO = new Map(); // sgCode -> {sido, sigungu}
for (const a of APTS) {
  if (!a || !a.sido || !a.sigungu) continue;
  const sg = a.sigunguCode || (a.sido + '|' + a.sigungu);
  if (!SIDO_MAP.has(a.sido)) SIDO_MAP.set(a.sido, new Map());
  const m = SIDO_MAP.get(a.sido);
  if (!m.has(sg)) m.set(sg, { sigungu: a.sigungu, count: 0 });
  m.get(sg).count++;
  if (!SGG_INFO.has(sg)) SGG_INFO.set(sg, { sido: a.sido, sigungu: a.sigungu });
}
function hubHtml(title, desc, canonical, body) {
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="google-adsense-account" content="ca-pub-3915435017395988">'
    + '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3915435017395988" crossorigin="anonymous"></script>'
    + '<title>' + esc(title) + '</title><meta name="description" content="' + esc(desc) + '">'
    + '<meta property="og:title" content="' + esc(title) + '"><meta property="og:site_name" content="아구구"><meta property="og:type" content="website">'
    + '<link rel="canonical" href="' + canonical + '"><link rel="icon" href="/favicon.ico" sizes="any">'
    + '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic",sans-serif;margin:0;background:#f7f8fa;color:#1a1a1a}'
    + '.wrap{max-width:760px;margin:0 auto;padding:18px 16px 60px}a{color:#15803d;text-decoration:none}a:hover{text-decoration:underline}'
    + '.bc{font-size:13px;color:#888;margin-bottom:10px}h1{font-size:21px;margin:6px 0 4px;line-height:1.35}.sub{color:#666;font-size:13px;margin-bottom:16px}'
    + 'h2{font-size:15px;margin:22px 0 8px;padding-bottom:6px;border-bottom:1px solid #e5e7eb}'
    + '.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:7px 13px;font-size:13px}.chip small{color:#aaa;font-size:11px}'
    + '.list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#eee;border:1px solid #eee;border-radius:10px;overflow:hidden}'
    + '.list li{background:#fff;padding:11px 13px;font-size:14px}.list li small{color:#999;font-size:11px;display:block;margin-top:1px}'
    + '@media(max-width:560px){.list{grid-template-columns:1fr}}footer{margin-top:30px;font-size:12px;color:#999;text-align:center}.rg-ad{text-align:center;margin:12px 0}'
    // 상단 고정 헤더 — 로고를 누르면 지도(아구구 홈)로 돌아감. 랭킹/지역 페이지에서 길 잃지 않게.
    + '.gnb{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #e9ecef;display:flex;align-items:center;gap:10px;padding:9px 14px}'
    + '.gnb-logo{display:flex;align-items:center;gap:7px;text-decoration:none!important}'
    + '.gnb-ico{width:26px;height:26px;border-radius:8px;background:#1D9E75;display:flex;align-items:center;justify-content:center}'
    + '.gnb-ico svg{width:15px;height:15px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}'
    + '.gnb-tx{font-size:16px;font-weight:800;color:#1D9E75;letter-spacing:-.5px}.gnb-tx b{color:#1a1a1a;font-weight:800}'
    + '.gnb-nav{margin-left:auto;display:flex;gap:4px}'
    + '.gnb-nav a{font-size:12.5px;font-weight:600;color:#555;padding:6px 10px;border-radius:7px;background:#f4f6f7}'
    + '.gnb-nav a:hover{background:#1D9E75;color:#fff;text-decoration:none}'
    + '.gnb-nav a.home{background:#e6f4ef;color:#15803d}'
    + '</style></head><body>'
    + '<div class="gnb"><a class="gnb-logo" href="' + BASE + '/">'
    + '<span class="gnb-ico"><svg viewBox="0 0 24 24"><path d="M3 10.5L12 4l9 6.5"/><path d="M5.5 9.8V20h13V9.8"/></svg></span>'
    + '<span class="gnb-tx">아구<b>구</b></span></a>'
    + '<span class="gnb-nav"><a class="home" href="' + BASE + '/">🗺️ 지도로</a>'
    + '<a href="/rank">랭킹</a><a href="/region">지역별</a></span></div>'
    + '<div class="wrap">'
    + '<div class="rg-ad"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="' + AD_UNIT_TOP + '" data-ad-width="320" data-ad-height="100"></ins></div>'
    + body
    + '<div class="rg-ad"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="' + AD_UNIT + '" data-ad-width="300" data-ad-height="250"></ins></div>'
    + '<script type="text/javascript" src="//t1.kakaocdn.net/kas/static/ba.min.js" async></script>'
    + '<footer><a href="/rank">아파트 랭킹</a> · <a href="/region">전국 지역별 아파트</a> · <a href="' + BASE + '/">아구구 홈</a> · © 2026 아구구</footer></div></body></html>';
}
function regionTopPage() {
  let body = '<div class="bc"><a href="' + BASE + '/">아구구</a> › 지역별 아파트</div>'
    + '<h1>전국 지역별 아파트 관리사무소 전화번호·관리비</h1>'
    + '<div class="sub">시·도와 시·군·구를 선택해 아파트 단지 정보를 확인하세요.</div>';
  for (const sido of SIDO_MAP.keys()) {
    const chips = [...SIDO_MAP.get(sido).entries()].map(([sg, info]) =>
      '<a class="chip" href="/region/' + encodeURIComponent(sg) + '">' + esc(info.sigungu) + ' <small>' + info.count + '</small></a>').join('');
    body += '<h2>' + esc(sido) + '</h2><div class="chips">' + chips + '</div>';
  }
  return hubHtml('전국 지역별 아파트 관리사무소 전화번호·관리비 | 아구구',
    '전국 시도·시군구별 아파트 단지 관리사무소 전화번호·관리비·실거래가를 아구구에서 확인하세요.', BASE + '/region', body);
}
function regionSggPage(sgCode) {
  const info = SGG_INFO.get(sgCode);
  const pool = BY_SGG.get(sgCode) || [];
  if (!info || !pool.length) return null;
  const apts = pool.slice().sort((x, y) => (x.name || '').localeCompare(y.name || '', 'ko'));
  const items = apts.map(b =>
    '<li><a href="/apt/' + b.code + '">' + esc(b.name) + '</a><small>' + esc(b.emd || '') + (b.units ? ' · ' + b.units + '세대' : '') + '</small></li>').join('');
  const title = info.sido + ' ' + info.sigungu + ' 아파트 관리사무소 전화번호·관리비 (' + apts.length + '개 단지) | 아구구';
  const body = '<div class="bc"><a href="' + BASE + '/">아구구</a> › <a href="/region">지역</a> › ' + esc(info.sido) + '</div>'
    + '<h1>' + esc(info.sido) + ' ' + esc(info.sigungu) + ' 아파트 관리사무소 전화번호·관리비</h1>'
    + '<div class="sub">' + esc(info.sigungu) + ' 아파트 단지 ' + apts.length + '개. 단지를 눌러 관리사무소 전화번호·관리비·실거래가를 확인하세요.</div>'
    + '<ul class="list">' + items + '</ul>';
  return hubHtml(title, esc(info.sido) + ' ' + esc(info.sigungu) + ' 아파트 단지 ' + apts.length + '개의 관리사무소 전화번호·관리비·실거래가 정보. 아구구.',
    BASE + '/region/' + encodeURIComponent(sgCode), body);
}

// ===== 랭킹 페이지 (/rank, /rank/{kind}, /rank/{kind}/{sido2}) — 2026-09-03 =====
// api/rank.js 를 따로 못 만드는 이유: Vercel 서버리스 함수 12개 한도가 이미 꽉 참.
// 그래서 aptpage.js 에 병합(관리비를 apt.js 에 합친 것과 같은 이유).
const SIDO2 = { '11':'서울','26':'부산','27':'대구','28':'인천','29':'광주','30':'대전','31':'울산',
  '36':'세종','41':'경기','43':'충북','44':'충남','46':'전남','47':'경북','48':'경남','50':'제주',
  '51':'강원','52':'전북' };

// ⚠️ chg_pct 등은 build_metrics.sql 재실행 전엔 없는 컬럼 → 400. 1회 폴백 후 기본 컬럼만 사용.
const RANK_SEL_FULL = 'kapt_code,name,dong,units,movein,rep_area_m2,price_m,py_m,jeonse_m,j_rate,gap_m,deal_cnt,chg_pct,deal_cnt_prev,price_prev_m,chg_base_ym';
const RANK_SEL_BASE = 'kapt_code,name,dong,units,movein,rep_area_m2,price_m,py_m,jeonse_m,j_rate,gap_m,deal_cnt';
let RANK_SEL = RANK_SEL_FULL;

async function rankQuery(filters, order, limit) {
  const run = async (sel) => {
    const q = ['select=' + sel, 'order=' + order, 'limit=' + limit].concat(filters).join('&');
    const r = await fetch(SUPABASE_URL + '/rest/v1/apt_metrics?' + q, {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
      signal: AbortSignal.timeout(4000)
    });
    return r;
  };
  try {
    let r = await run(RANK_SEL);
    if (!r.ok && RANK_SEL === RANK_SEL_FULL) { RANK_SEL = RANK_SEL_BASE; r = await run(RANK_SEL); }
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}
const hasChg = () => RANK_SEL === RANK_SEL_FULL;

// 랭킹 정의. scope = 시도 2자리(''이면 전국)
const RANKS = {
  py: {
    name: '평당가', h1: s => s + ' 아파트 평당가 순위',
    lead: '최근 18개월 실거래 기준 평당가가 높은 단지입니다.',
    base: ['units=gte.300', 'deal_cnt=gte.3', 'py_m=not.is.null'],
    order: 'py_m.desc',
    val: r => wonMan(r.py_m) + ' / 평',
    sub: r => '매매 ' + wonMan(r.price_m) + ' · ' + Math.round(r.rep_area_m2) + '㎡'
  },
  jrate: {
    name: '전세가율', h1: s => s + ' 전세가율 높은 아파트',
    lead: '매매가 대비 전세가 비율이 높은 단지입니다. 전세 계약 전 보증금 회수 위험을 함께 살펴보세요.',
    base: ['units=gte.300', 'deal_cnt=gte.3', 'j_rate=not.is.null', 'j_rate=gte.80'],
    order: 'j_rate.desc',
    val: r => r.j_rate + '%',
    sub: r => '매매 ' + wonMan(r.price_m) + ' · 전세 ' + wonMan(r.jeonse_m),
    warn: true
  },
  up: {
    name: '상승', h1: s => s + ' 아파트 실거래가 상승 순위',
    lead: '직전 1년 구간 평균과 비교해 대표평형 실거래가가 많이 오른 단지입니다.',
    base: ['units=gte.300', 'deal_cnt=gte.3', 'deal_cnt_prev=gte.3', 'chg_pct=not.is.null'],
    order: 'chg_pct.desc', needChg: true,
    val: r => '+' + r.chg_pct + '%',
    sub: r => wonMan(r.price_prev_m) + ' → ' + wonMan(r.price_m)
  },
  down: {
    name: '하락', h1: s => s + ' 아파트 실거래가 하락 순위',
    lead: '직전 1년 구간 평균과 비교해 대표평형 실거래가가 많이 내린 단지입니다.',
    base: ['units=gte.300', 'deal_cnt=gte.3', 'deal_cnt_prev=gte.3', 'chg_pct=not.is.null'],
    order: 'chg_pct.asc', needChg: true,
    val: r => r.chg_pct + '%',
    sub: r => wonMan(r.price_prev_m) + ' → ' + wonMan(r.price_m)
  }
};
// 갭은 가격대별 3구간이라 별도 취급
const GAP_BANDS = [
  { key: 'a', label: '매매 3억 이하', f: ['price_m=lt.30000'] },
  { key: 'b', label: '매매 3~6억',   f: ['price_m=gte.30000', 'price_m=lt.60000'] },
  { key: 'c', label: '매매 6억 이상', f: ['price_m=gte.60000'] }
];

function rankRows(rows, cfg) {
  if (!rows.length) return '<div class="rk-empty">조건에 맞는 단지가 아직 없습니다.</div>';
  return '<ol class="rk">' + rows.map(r => {
    const sgg = SGG_INFO.get(String(r.dong || '').slice(0, 5));
    const loc = sgg ? (sgg.sido.slice(0, 2) + ' ' + sgg.sigungu) : '';
    const py = r.rep_area_m2 ? Math.round(r.rep_area_m2 / 0.75 / 3.3058 * 10) / 10 + '평형' : '';
    const risk = (cfg.warn && r.j_rate >= 95) ? '<span class="rk-risk">보증금 주의</span>' : '';
    return '<li><a href="/apt/' + r.kapt_code + '"><span class="rk-nm">' + esc(r.name || '') + risk + '</span>'
      + '<span class="rk-loc">' + esc(loc) + (r.units ? ' · ' + Number(r.units).toLocaleString() + '세대' : '')
      + (r.movein ? ' · ' + r.movein + '년' : '') + (py ? ' · ' + py : '') + '</span></a>'
      + '<span class="rk-v"><b>' + cfg.val(r) + '</b><small>' + cfg.sub(r) + '</small></span></li>';
  }).join('') + '</ol>';
}

function rankNav(kind, scope) {
  const kinds = [['py', '평당가'], ['gap', '갭 작은 단지'], ['jrate', '전세가율'], ['up', '상승'], ['down', '하락']];
  const tabs = kinds.map(([k, n]) =>
    '<a class="chip' + (k === kind ? ' on' : '') + '" href="/rank/' + k + (scope ? '/' + scope : '') + '">' + n + '</a>').join('');
  const areas = ['<a class="chip' + (!scope ? ' on' : '') + '" href="/rank/' + kind + '">전국</a>']
    .concat(Object.keys(SIDO2).map(c =>
      '<a class="chip' + (c === scope ? ' on' : '') + '" href="/rank/' + kind + '/' + c + '">' + SIDO2[c] + '</a>')).join('');
  return '<h2>다른 순위</h2><div class="chips">' + tabs + '</div>'
    + '<h2>지역별</h2><div class="chips">' + areas + '</div>';
}

const RANK_CSS = '<style>'
  + '.rk{list-style:none;padding:0;margin:0 0 6px;counter-reset:rk}'
  + '.rk li{counter-increment:rk;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #eee;border-top:none;padding:11px 13px}'
  + '.rk li:first-child{border-top:1px solid #eee;border-radius:10px 10px 0 0}.rk li:last-child{border-radius:0 0 10px 10px}'
  + '.rk li::before{content:counter(rk);flex:none;width:24px;height:24px;border-radius:6px;background:#f1f3f5;color:#888;'
  + 'font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}'
  + '.rk li:nth-child(-n+3)::before{background:#15803d;color:#fff}'
  + '.rk li a{flex:1;min-width:0;display:block}.rk-nm{display:block;font-size:14px;font-weight:600;color:#1a1a1a;line-height:1.35}'
  + '.rk-loc{display:block;font-size:11.5px;color:#999;margin-top:1px}'
  + '.rk-v{flex:none;text-align:right}.rk-v b{display:block;font-size:14.5px;font-weight:700}'
  + '.rk-v small{display:block;font-size:11px;color:#999;margin-top:1px}'
  + '.rk-risk{display:inline-block;background:#fdecea;color:#c0392f;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:20px;margin-left:5px}'
  + '.rk-empty{background:#fff;border:1px solid #eee;border-radius:10px;padding:22px;text-align:center;color:#999;font-size:13px}'
  + '.chip.on{background:#15803d;color:#fff;border-color:#15803d}'
  + '.rk-note{font-size:12px;color:#999;margin:10px 0 0;line-height:1.6}'
  + '</style>';

async function rankPage(kind, scope) {
  const sName = scope ? (SIDO2[scope] || '') : '전국';
  if (scope && !SIDO2[scope]) return null;
  const areaF = scope ? ['dong=like.' + scope + '*'] : [];
  const ym = new Date(); const stamp = ym.getFullYear() + '년 ' + (ym.getMonth() + 1) + '월';

  let body = '<div class="bc"><a href="' + BASE + '/">아구구</a> › <a href="/rank">아파트 랭킹</a>'
    + (scope ? ' › ' + esc(sName) : '') + '</div>';

  if (kind === 'gap') {
    body += '<h1>' + esc(sName) + ' 매매·전세 갭 작은 아파트</h1>'
      + '<div class="sub">전세가율 85% 이하인 단지만 담았습니다. 가격대별로 나눠 보세요. · ' + stamp + ' 기준</div>';
    for (const b of GAP_BANDS) {
      const rows = await rankQuery(
        ['units=gte.300', 'deal_cnt=gte.5', 'gap_m=gt.0', 'j_rate=lte.85', 'j_rate=gte.40'].concat(b.f, areaF),
        'gap_m.asc', 20);
      body += '<h2>' + b.label + '</h2>' + rankRows(rows, {
        val: r => '갭 ' + wonMan(r.gap_m),
        sub: r => '매매 ' + wonMan(r.price_m) + ' · 전세가율 ' + r.j_rate + '%'
      });
    }
    body += '<p class="rk-note">※ 갭이 지나치게 작은 단지는 전세가가 매매가에 근접했다는 뜻이기도 합니다. '
      + '전세가율 85%를 넘는 단지는 이 목록에서 제외했고, <a href="/rank/jrate' + (scope ? '/' + scope : '') + '">전세가율 높은 아파트</a>에서 따로 확인하실 수 있습니다. '
      + '실제 계약 전에는 등기부·보증보험 가입 가능 여부를 반드시 확인하세요.</p>';
  } else {
    const cfg = RANKS[kind];
    if (!cfg) return null;
    if (cfg.needChg && !hasChg()) {
      body += '<h1>' + esc(cfg.h1(sName)) + '</h1><div class="sub">' + stamp + ' 기준</div>'
        + '<div class="rk-empty">변동률 데이터를 준비 중입니다.<br>잠시 후 다시 확인해 주세요.</div>';
    } else {
      const rows = await rankQuery(cfg.base.concat(areaF), cfg.order, 30);
      body += '<h1>' + esc(cfg.h1(sName)) + '</h1>'
        + '<div class="sub">' + esc(cfg.lead) + ' · ' + stamp + ' 기준</div>'
        + rankRows(rows, cfg)
        + '<p class="rk-note">※ 300세대 이상 · 최근 18개월 실거래 3건 이상 단지만 집계했습니다. '
        + (cfg.needChg ? '직전 구간에도 3건 이상 거래가 있는 단지만 포함해, 거래 1~2건으로 변동률이 튀는 경우를 걸렀습니다. ' : '')
        + '국토교통부 공개 실거래가 기준이며 실제와 차이가 있을 수 있습니다.</p>';
    }
  }

  body += rankNav(kind, scope) + RANK_CSS;
  const kindName = kind === 'gap' ? '갭 작은' : RANKS[kind].name;
  const title = sName + ' 아파트 ' + kindName + ' 순위 | 아구구';
  return hubHtml(title,
    sName + ' 아파트 ' + kindName + ' 순위를 국토교통부 실거래가 기준으로 정리했습니다. ' + stamp + ' 기준.',
    BASE + '/rank/' + kind + (scope ? '/' + scope : ''), body);
}

const RANK_ICONS = {
  py   :'<path d="M3 20h18"/><path d="M6 20V9"/><path d="M12 20V4"/><path d="M18 20v-7"/>',
  gap  :'<path d="M7 4v16"/><path d="M17 4v16"/><path d="M10 12h4"/><path d="M10 12l1.6-1.6"/><path d="M14 12l-1.6 1.6"/>',
  jrate:'<path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6z"/><path d="M9.5 14.5l5-5"/><circle cx="9.8" cy="9.8" r="1"/><circle cx="14.2" cy="14.2" r="1"/>',
  up   :'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  down :'<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  region:'<path d="M12 21s-7-5.7-7-11a7 7 0 1 1 14 0c0 5.3-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/>'
};
const RANK_HUB_CSS = '<style>'
  // 아실 '부동산 스터디'식 — 작은 아이콘을 한 줄에 촘촘히
  + '.hub{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;margin:2px 0 10px}'
  + '@media(max-width:560px){.hub{grid-template-columns:repeat(4,1fr)}}'
  + '@media(max-width:360px){.hub{grid-template-columns:repeat(3,1fr)}}'
  + '.hub a{display:flex;flex-direction:column;align-items:center;gap:7px;padding:11px 3px;'
  + 'border-radius:9px;text-decoration:none!important;transition:background .12s}'
  + '.hub a:hover{background:#eef4f1}'
  + '.hub-ic{width:44px;height:44px;border-radius:50%;background:#f2f5f4;display:flex;align-items:center;justify-content:center;transition:background .12s}'
  + '.hub a:hover .hub-ic{background:#1D9E75}'
  + '.hub-ic svg{width:21px;height:21px;stroke:#1D9E75;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;transition:stroke .12s}'
  + '.hub a:hover .hub-ic svg{stroke:#fff}'
  + '.hub-t{font-size:11.5px;font-weight:600;color:#555;text-align:center;line-height:1.25;word-break:keep-all}'
  + '.chip.on{background:#15803d;color:#fff;border-color:#15803d}'
  + '</style>';

function rankIndexPage(scope) {
  const code = (scope && SIDO2[scope]) ? scope : '';
  const sName = code ? SIDO2[code] : '전국';
  const suf = code ? '/' + code : '';
  const items = [
    ['py', '평당가'], ['gap', '갭투자'], ['jrate', '전세가율'],
    ['up', '최고상승'], ['down', '최근하락']
  ];
  let body = '<div class="bc"><a href="' + BASE + '/">아구구</a> › 아파트 랭킹'
    + (code ? ' › ' + esc(sName) : '') + '</div>'
    + '<h1>' + esc(sName) + ' 아파트 랭킹</h1>'
    + '<div class="sub">국토교통부 공개 실거래가를 단지별로 집계해 순위로 정리했습니다. 보고 싶은 순위를 눌러보세요.</div>'
    + '<div class="hub">'
    + items.map(([k, t]) =>
        '<a href="/rank/' + k + suf + '"><span class="hub-ic"><svg viewBox="0 0 24 24">' + RANK_ICONS[k] + '</svg></span>'
        + '<span class="hub-t">' + t + '</span></a>').join('')
    + '<a href="/region"><span class="hub-ic"><svg viewBox="0 0 24 24">' + RANK_ICONS.region + '</svg></span>'
    + '<span class="hub-t">지역별</span></a>'
    + '</div>'
    + '<h2>지역 바꾸기</h2><div class="chips">'
    + '<a class="chip' + (code ? '' : ' on') + '" href="/rank">전국</a>'
    + Object.keys(SIDO2).map(c =>
        '<a class="chip' + (c === code ? ' on' : '') + '" href="/rank/all/' + c + '">' + SIDO2[c] + '</a>').join('')
    + '</div>' + RANK_HUB_CSS;
  return hubHtml(
    sName + ' 아파트 랭킹 — 평당가·갭·전세가율·상승률 | 아구구',
    sName + ' 아파트를 평당가·매매전세갭·전세가율·실거래가 변동률로 정리한 순위. 국토교통부 실거래가 기준.',
    BASE + '/rank', body);   // canonical은 항상 /rank — 지역별 허브는 중복 색인 방지
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // ===== 랭킹 라우팅 (/rank, /rank/{kind}, /rank/{kind}/{시도2자리}) =====
  const rank = (req.query && req.query.rank) || '';
  if (rank) {
    const scope = (req.query && req.query.scope) || '';
    const html = (rank === 'index' || rank === 'all')
      ? rankIndexPage(scope)
      : await rankPage(rank, scope);
    if (html) {
      res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=43200, stale-while-revalidate=604800');
      res.statusCode = 200; res.end(html); return;
    }
    res.statusCode = 404;
    res.end('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>순위를 찾을 수 없습니다 | 아구구</title></head><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>순위를 찾을 수 없습니다</h1><p><a href="/rank">아파트 랭킹</a> · <a href="https://a99.co.kr">아구구 홈</a></p></body></html>');
    return;
  }
  const region = (req.query && req.query.region) || '';
  if (region) {
    const html = (region === 'all' || region === 'index') ? regionTopPage() : regionSggPage(region);
    if (html) {
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
      res.statusCode = 200; res.end(html); return;
    }
    res.statusCode = 404;
    res.end('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>지역을 찾을 수 없습니다 | 아구구</title></head><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>지역을 찾을 수 없습니다</h1><p><a href="/region">지역별 아파트</a> · <a href="https://a99.co.kr">아구구 홈</a></p></body></html>');
    return;
  }
  const code = (req.query && req.query.code) || '';
  const a = BY_CODE.get(code);
  if (!a) {
    res.statusCode = 404;
    res.end('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>단지를 찾을 수 없습니다 | 아구구</title></head><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>단지를 찾을 수 없습니다</h1><p><a href="https://a99.co.kr">아구구 홈으로</a></p></body></html>');
    return;
  }
  const metrics = await fetchMetrics(code);
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  res.statusCode = 200;
  res.end(page(a, metrics));
};
