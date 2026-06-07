/**
 * add_missing_apts.js
 * 엑셀에는 있지만 split_output에 없는 아파트 529개를
 * 카카오 지오코딩으로 좌표 받아 추가합니다.
 *
 * 사용법:
 *   node add_missing_apts.js
 */

const XLSX   = require('xlsx');
const fs     = require('fs');
const path   = require('path');
const https  = require('https');

const KAKAO_KEY  = 'be82d140cac4386ee76d82cc16c65c3e';
const EXCEL_PATH = 'C:\\Users\\essoz\\Desktop\\files\\20260605_단지_기본정보.xlsx';
const SPLIT_DIR  = path.join(__dirname, 'split_output');
const PROGRESS_PATH = path.join(__dirname, 'progress_missing.json');

// ── 1. 기존 코드 수집 ────────────────────────────────────
const ourCodes = new Set();
fs.readdirSync(SPLIT_DIR).filter(f=>f.startsWith('coords_apt_')&&f.endsWith('.json')).forEach(f=>{
  JSON.parse(fs.readFileSync(path.join(SPLIT_DIR,f),'utf8')).forEach(d=>{ if(d.code) ourCodes.add(d.code); });
});
console.log('기존 단지 수:', ourCodes.size);

// ── 2. 엑셀에서 누락 아파트 추출 ────────────────────────
console.log('엑셀 읽는 중...');
const wb  = XLSX.readFile(EXCEL_PATH);
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1});
const h   = raw[1];
const c   = {};
['단지코드','단지명','단지분류','도로명주소','법정동주소','시도','시군구','읍면','동리',
 '세대수','복도유형','시공사','총주차대수','동수','최고층수','난방방식','분양형태','사용승인일'
].forEach(k=>{ const i=h.indexOf(k); if(i>=0) c[k]=i; });

const missing = [];
for(let r=2;r<raw.length;r++){
  const row = raw[r];
  const code = row[c['단지코드']];
  if(!code || ourCodes.has(code)) continue;
  if(row[c['단지분류']] !== '아파트') continue;
  const addr = (row[c['도로명주소']]||row[c['법정동주소']]||'').trim();
  if(!addr) continue;

  const builtRaw = String(row[c['사용승인일']]||'').trim();
  let built = '';
  if(builtRaw.length===8) built = builtRaw.slice(0,4)+'.'+builtRaw.slice(4,6);

  const sigunguCode = ''; // 나중에 채움
  missing.push({
    code, addr,
    name:      row[c['단지명']]||'',
    sido:      row[c['시도']]||'',
    sigungu:   row[c['시군구']]||'',
    emd:       (row[c['읍면']]||'')+(row[c['동리']]||''),
    units:     parseInt(row[c['세대수']])||0,
    entrance:  (row[c['복도유형']]||'').trim(),
    builder:   (row[c['시공사']]||'').trim(),
    totalPark: parseInt(row[c['총주차대수']])||0,
    dongCnt:   row[c['동수']]?String(row[c['동수']]).trim()+'동':'',
    topFloor:  parseInt(row[c['최고층수']])||0,
    heat:      row[c['난방방식']]||'',
    sale:      row[c['분양형태']]||'',
    built,
    jibunAddr: (row[c['법정동주소']]||'').trim(),
  });
}
console.log('누락 아파트(아파트 분류):', missing.length);

// ── 3. 진행상황 불러오기 ─────────────────────────────────
const progress = fs.existsSync(PROGRESS_PATH)
  ? JSON.parse(fs.readFileSync(PROGRESS_PATH,'utf8'))
  : { done: {} };

// ── 4. 카카오 지오코딩 ───────────────────────────────────
function geocode(addr){
  return new Promise(resolve=>{
    const url = 'https://dapi.kakao.com/v2/local/search/address.json?query='+encodeURIComponent(addr);
    https.get(url, {headers:{'Authorization':'KakaoAK '+KAKAO_KEY}}, res=>{
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>{
        try{
          const j=JSON.parse(data);
          if(j.documents&&j.documents.length>0){
            resolve({lat:parseFloat(j.documents[0].y), lng:parseFloat(j.documents[0].x)});
          } else resolve(null);
        }catch(e){ resolve(null); }
      });
    }).on('error',()=>resolve(null));
  });
}

// sigungu 코드 추출 (coords_apt_XXXXX.json 파일명용)
function getSigunguCode(sido, sigungu){
  // 기존 파일에서 같은 시도+시군구 코드 찾기
  const files = fs.readdirSync(SPLIT_DIR).filter(f=>f.startsWith('coords_apt_')&&f.endsWith('.json'));
  for(const f of files){
    const data = JSON.parse(fs.readFileSync(path.join(SPLIT_DIR,f),'utf8'));
    const found = data.find(d=>d.sido===sido&&d.sigungu===sigungu);
    if(found) return found.sigunguCode||f.replace('coords_apt_','').replace('.json','');
  }
  return null;
}

// ── 5. 메인 실행 ─────────────────────────────────────────
(async()=>{
  let success=0, fail=0, skip=0;
  const toAdd = {}; // sigunguCode → [apt, ...]

  for(let i=0;i<missing.length;i++){
    const apt = missing[i];
    if(progress.done[apt.code]){ skip++; continue; }

    await new Promise(r=>setTimeout(r,150)); // 150ms 간격

    const geo = await geocode(apt.addr);
    if(!geo){ fail++; progress.done[apt.code]='fail'; continue; }

    const sigunguCode = getSigunguCode(apt.sido, apt.sigungu) || '99999';
    const entry = {
      code: apt.code, name: apt.name, lat: geo.lat, lng: geo.lng,
      units: apt.units, emd: apt.emd, sigunguCode,
      sido: apt.sido, sigungu: apt.sigungu,
      built: apt.built, dongCnt: apt.dongCnt, heat: apt.heat,
      sale: apt.sale, topFloor: apt.topFloor, addr: apt.addr,
      jibunAddr: apt.jibunAddr, builder: apt.builder,
      entrance: apt.entrance, totalPark: apt.totalPark,
      aptType: '아파트', mgrType: '',
    };

    if(!toAdd[sigunguCode]) toAdd[sigunguCode]=[];
    toAdd[sigunguCode].push(entry);
    progress.done[apt.code]='ok';
    success++;

    if(success%50===0){
      process.stdout.write(`\r진행: ${i+1}/${missing.length} (성공:${success} 실패:${fail})`);
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress),'utf8');
    }
  }

  // ── 6. JSON 파일에 추가 ────────────────────────────────
  for(const [sc, apts] of Object.entries(toAdd)){
    const fp = path.join(SPLIT_DIR, `coords_apt_${sc}.json`);
    let existing = [];
    if(fs.existsSync(fp)) existing = JSON.parse(fs.readFileSync(fp,'utf8'));
    const newData = [...existing, ...apts];
    fs.writeFileSync(fp, JSON.stringify(newData),'utf8');
  }

  // ── 7. coords_all_apt.json 갱신 ───────────────────────
  const allPath = path.join(SPLIT_DIR,'coords_all_apt.json');
  if(fs.existsSync(allPath)){
    const all = JSON.parse(fs.readFileSync(allPath,'utf8'));
    Object.values(toAdd).flat().forEach(a=>all.push(a));
    fs.writeFileSync(allPath, JSON.stringify(all),'utf8');
  }

  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress),'utf8');
  console.log(`\n\n✅ 완료! 성공:${success} 실패:${fail} 건너뜀:${skip}`);
  console.log('git add . && git commit -m "누락 아파트 529개 추가" && git push');
})();
