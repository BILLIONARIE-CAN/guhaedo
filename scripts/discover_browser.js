// 누락 아파트 단지 탐색 — 브라우저 콘솔용 (api/discover.js 가 500 나서 이걸로 대체)
//
// 사용법: https://a99.co.kr 를 연 뒤 개발자도구 콘솔에 이 파일 내용을 통째로 붙여넣기.
//   진행 상황은 localStorage 의 disc_i / disc_stat 에 저장되고, 탭을 닫았다 열어도 이어서 진행됨.
//   상태 확인: RUN.stat2()      중단: RUN.stop = true
//
// 하는 일: 시군구 252곳 × 최근 6개월 국토부 실거래 목록을 받아 apt_map 에 없는 단지를 찾고,
//          카카오 지오코더로 좌표를 붙여 apt_map 에 src='discover' 로 넣는다.
//          중복 판정은 (정규화한 단지명) 또는 (법정동+지번) 둘 중 하나라도 걸리면 '이미 있음'.
window.RUN={}; const R=window.RUN;
R.H={apikey:SUPABASE_ANON,Authorization:'Bearer '+SUPABASE_ANON};
R.MONTHS=(function(){const a=[],d=new Date();for(let k=1;k<=6;k++){const t=new Date(d.getFullYear(),d.getMonth()-k,1);
  a.push(''+t.getFullYear()+String(t.getMonth()+1).padStart(2,'0'));}return a;})();
R.norm=s=>String(s||'').replace(/[\s()（）·\-\/,，]/g,'').replace(/아파트$/,'').replace(/(\d+)차/g,'$1단지');
R.emdOf=d=>String(d||'').trim().split(/\s+/)[0]||'';
R.jibunKey=(emd,j)=>emd+'|'+String(j||'').trim();
R.parseJibun=function(ja){const p=String(ja||'').trim().split(/\s+/);
  for(let i=2;i<p.length-1;i++){ if(/^\d+(-\d+)?$/.test(p[i+1])) return [p[i],p[i+1]]; } return ['','']; };
R.geo=new kakao.maps.services.Geocoder();
R.geocode=addr=>new Promise(res=>{let done=false;const t=setTimeout(()=>{if(!done){done=true;res(null);}},6000);
  R.geo.addressSearch(addr,function(rs,st){if(done)return;done=true;clearTimeout(t);
    res((st===kakao.maps.services.Status.OK&&rs[0])?[parseFloat(rs[0].y),parseFloat(rs[0].x)]:null);});});
R.existing=async function(code){const set=new Set();
  for(let off=0;;off+=1000){
    const rows=await fetch(SUPABASE_URL+'/rest/v1/apt_map?select=name,jibun_addr&sigungu_code=eq.'+code+'&limit=1000&offset='+off,{headers:R.H}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(rows)||!rows.length) break;
    for(const r of rows){ set.add('N:'+R.norm(r.name)); const [e,j]=R.parseJibun(r.jibun_addr); if(j) set.add('J:'+R.jibunKey(e,j)); }
    if(rows.length<1000) break; }
  return set; };
R.one=async function(g){
  const res=await Promise.all(R.MONTHS.map(ym=>fetch('/api/diag?op=district&lawdCd='+g.code+'&ym='+ym,{signal:AbortSignal.timeout(28000)}).then(r=>r.json()).catch(()=>null)));
  const found=new Map(); let emptyMonths=0;
  for(const d of res){ if(!d){emptyMonths++;continue;}
    const all=[].concat(d.buy||[],d.rent||[],d.pre||[]); if(!all.length) emptyMonths++;
    for(const x of all){ if(!x.n||!x.j) continue;
      const k=R.norm(x.n)+'|'+R.emdOf(x.d)+'|'+x.j;
      if(!found.has(k)) found.set(k,{n:x.n.trim(),d:String(x.d||'').trim(),j:String(x.j).trim(),by:x.by||0}); } }
  if(emptyMonths>=R.MONTHS.length) return {quotaSuspect:true,added:0,found:0,miss:0,geofail:0};
  const ex=await R.existing(g.code);
  const miss=[...found.values()].filter(v=>!ex.has('N:'+R.norm(v.n))&&!ex.has('J:'+R.jibunKey(R.emdOf(v.d),v.j)));
  let added=0,geofail=0; const rows=[];
  for(const v of miss){ const c=await R.geocode(g.sido+' '+g.name+' '+v.d+' '+v.j);
    if(!c){geofail++;continue;}
    rows.push({code:'DISC_'+g.code+'_'+v.n,name:v.n,lat:c[0],lng:c[1],sido:g.sido,sigungu:g.name,
      emd:R.emdOf(v.d),sigungu_code:g.code,jibun_addr:g.sido+' '+g.name+' '+v.d+' '+v.j+' '+v.n,
      built:v.by?(v.by+'.01'):null,movein:v.by||null,apt_type:'아파트',src:'discover'});
    await new Promise(s=>setTimeout(s,90)); }
  for(let k=0;k<rows.length;k+=200){ const b=rows.slice(k,k+200);
    const r=await fetch(SUPABASE_URL+'/rest/v1/apt_map',{method:'POST',
      headers:Object.assign({},R.H,{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),
      body:JSON.stringify(b)});
    if(r.ok) added+=b.length; else R.lastErr=(await r.text()).slice(0,200); }
  return {added,found:found.size,miss:miss.length,geofail}; };
R.save=function(){try{localStorage.setItem('disc_i',String(R.i));localStorage.setItem('disc_stat',JSON.stringify(R.stat));}catch(e){}
  // 서버에도 진행률을 남긴다 → /api/warm?status=1 에서 브라우저 없이 확인 가능
  fetch(SUPABASE_URL+'/rest/v1/briefs',{method:'POST',
    headers:Object.assign({},R.H,{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),
    body:JSON.stringify([{id:'disc_state',data:{i:R.i,total:R.sgg.length,saved:R.stat.저장,found:R.stat.발견,
      geofail:R.stat.좌표실패,at:new Date().toISOString().slice(0,16).replace('T',' ')}}])}).catch(function(){});};
R.loop=async function(){ R.running=true; R.empty=0;
  try{ while(!R.stop&&R.i<R.sgg.length){ const g=R.sgg[R.i];
      const r=await R.one(g).catch(()=>null);
      if(r&&r.quotaSuspect){ R.empty++; if(R.empty>=4){ R.paused='국토부 일일한도 소진 추정 — 내일 재개'; break; } }
      else if(r){ R.empty=0; R.stat.발견+=r.found; R.stat.저장+=r.added; R.stat.좌표실패+=r.geofail;
        R.stat.지역별.push(g.name+':'+r.added); }
      R.i++; R.save();
      document.title='⏳탐색 '+R.i+'/'+R.sgg.length+' 저장'+R.stat.저장+' — 아구구';
      await new Promise(s=>setTimeout(s,400)); } }
  finally{ R.save(); R.running=false; } };
R.stat2=()=>({i:R.i,total:R.sgg.length,발견:R.stat.발견,저장:R.stat.저장,좌표실패:R.stat.좌표실패,running:R.running,paused:R.paused||'',err:R.lastErr||''});
(async function(){
  R.sgg=await fetch('/split_output/coords_sigungu.json').then(r=>r.json());
  R.i=parseInt(localStorage.getItem('disc_i')||'0')||0;
  R.stat=JSON.parse(localStorage.getItem('disc_stat')||'{"발견":0,"저장":0,"좌표실패":0,"지역별":[]}');
  R.stop=false; R.paused='';
  R.wd=setInterval(function(){ if(!R.running&&!R.stop&&!R.paused&&R.i<R.sgg.length) R.loop(); },20000);
  R.loop();
  console.log('탐색 시작:',R.i,'/',R.sgg.length);
})();
