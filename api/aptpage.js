// =============================================================
//  전국 단지 검색페이지 - 서버 즉석 생성(serverless)
//  요청: /apt/{코드}  (vercel.json rewrite → /api/aptpage?code={코드})
//  데이터: split_output/coords_all_apt.json (전국) + kapt_tel.json (전화번호)
//  → 파일 2만개 안 만들고 페이지 2만개를 서버가 그때그때 렌더링
// =============================================================
const APTS = require('../split_output/coords_all_apt.json');
let TEL = {};
try { TEL = require('../split_output/kapt_tel.json'); } catch (e) {}

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
  return '<section class="nearby"><h2>🏢 ' + label + '</h2><ul class="nearby-list">' + items + '</ul></section>';
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
    ['세대당 주차', (a.totalPark && a.units) ? (Number(a.totalPark) / Number(a.units)).toFixed(2) + '대' : '-'],
    ['시공사', a.builder || '-'],
    ['관리방식', a.mgrType || '-'],
  ].map(x => '<div class="cell"><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>').join('');

  const sidoOpts = '<option value="">전국</option>' + SIDO_LIST.map(s => '<option>' + s + '</option>').join('');
  const sggOpts = '<option value="">전체 시군구</option>';

  return '<!DOCTYPE html><html lang="ko"><head>'
+ '<script async src="https://www.googletagmanager.com/gtag/js?id=G-B2NJPFNP69"></script>'
+ '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'G-B2NJPFNP69\');</script>'
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
+ '.tel-sub{font-size:12px;color:#16a34a;margin-top:2px}.tel-none{color:#999;font-size:14px}'
+ '.cta{display:block;width:100%;background:#16a34a;color:#fff;text-align:center;font-weight:700;font-size:16px;padding:15px;border-radius:12px;text-decoration:none;box-shadow:0 4px 12px rgba(22,163,74,.3)}'
+ '.cta small{display:block;font-weight:400;font-size:12px;opacity:.9;margin-top:2px}'
+ '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#eee;border-top:1px solid #eee;border-bottom:1px solid #eee}'
+ '.cell{background:#fff;padding:12px 6px;text-align:center}.cell .k{font-size:11px;color:#999}.cell .v{font-size:13px;font-weight:700;margin-top:3px}'
+ 'section{padding:18px 16px;border-bottom:8px solid #f5f7fa}h2{font-size:15px;font-weight:800;margin-bottom:10px}'
+ '.info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:14px}.info-row .k{color:#888}.info-row .v{font-weight:600;text-align:right}'
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
+ '</body></html>';
}

module.exports = (req, res) => {
  const code = (req.query && req.query.code) || '';
  const a = BY_CODE.get(code);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!a) {
    res.statusCode = 404;
    res.end('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>단지를 찾을 수 없습니다 | 아구구</title></head><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>단지를 찾을 수 없습니다</h1><p><a href="https://a99.co.kr">아구구 홈으로</a></p></body></html>');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  res.statusCode = 200;
  res.end(page(a));
};
