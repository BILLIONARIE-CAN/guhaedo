/**
 * retry_missing_apts.js
 * add_missing_apts.js에서 실패한 항목을 재시도하고 실패 이유를 출력합니다.
 *
 * 사용법: node retry_missing_apts.js
 */

const XLSX   = require('xlsx');
const fs     = require('fs');
const path   = require('path');
const https  = require('https');

const KAKAO_KEY     = 'be82d140cac4386ee76d82cc16c65c3e';
const EXCEL_PATH    = 'C:\\Users\\essoz\\Desktop\\files\\20260605_단지_기본정보.xlsx';
const SPLIT_DIR     = path.join(__dirname, 'split_output');
const PROGRESS_PATH = path.join(__dirname, 'progress_missing.json');

// ── 1. 기존 코드 수집 ────────────────────────────────────
const ourCodes = new Set();
fs.readdirSync(SPLIT_DIR).filter(f=>f.startsWith('coords_apt_')&&f.endsWith('.json')).forEach(f=>{
  JSON.parse(fs.readFileSync(path.join(SPLIT_DIR,f),'utf8')).forEach(d=>{ if(d.code) ourCodes.add(d.code); });
});

// ── 2. 진행상황에서 실패 목록 확인 ─────────────────────
const progress = fs.existsSync(PROGRESS_PATH)
  ? JSON.parse(fs.readFileSync(PROGRESS_PATH,'utf8'))
  : { done: {} };

const failedCodes = Object.entries(progress.done)
  .filter(([,v])=>v==='fail')
  .map(([k])=>k);
console.log(`실패했던 항목: ${failedCodes.length}개`);

// ── 3. 엑셀에서 실패 항목 추출 ──────────────────────────
const wb  = XLSX.readFile(EXCEL_PATH);
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1});
const h   = raw[1];
const c   = {};
['단지코드','단지명','단지분류','도로명주소','법정동주소','시도','시군구','읍면','동리',
 '세대수','복도유형','시공사','총주차대수','동수','최고층수','난방방식','분양형태','사용승인일'
].forEach(k=>{ const i=h.indexOf(k); if(i>=0) c[k]=i; });

const failedSet = new Set(failedCodes);
const targets = [];
for(let r=2;r<raw.length;r++){
  const row = raw[r];
  const code = row[c['단지코드']];
  if(!code || !failedSet.has(code)) continue;

  const addrRoad = (row[c['도로명주소']]||'').trim();
  const addrJibun = (row[c['법정동주소']]||'').trim();
  const builtRaw = String(row[c['사용승인일']]||'').trim();
  let built = '';
  if(builtRaw.length===8) built = builtRaw.slice(0,4)+'.'+builtRaw.slice(4,6);

  targets.push({
    code, addrRoad, addrJibun,
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
    built, jibunAddr: addrJibun,
  });
}
console.log(`재시도 대상: ${targets.length}개\n`);

// ── 4. 지오코딩 (실패 이유 포함) ────────────────────────
function geocode(addr, label){
  return new Promise(resolve=>{
    if(!addr){
      console.log(`  ❌ [${label}] 주소 없음`);
      return resolve(null);
    }
    const url = 'https://dapi.kakao.com/v2/local/search/address.json?query='+encodeURIComponent(addr);
    https.get(url, {headers:{'Authorization':'KakaoAK '+KAKAO_KEY}}, res=>{
      let data='';
      res.on('data',ch=>data+=ch);
      res.on('end',()=>{
        try{
          const j=JSON.parse(data);
          if(j.documents&&j.documents.length>0){
            resolve({lat:parseFloat(j.documents[0].y), lng:parseFloat(j.documents[0].x)});
          } else {
            console.log(`  ❌ [${label}] 검색결과 없음 | 주소: "${addr}"`);
            resolve(null);
          }
        }catch(e){
          console.log(`  ❌ [${label}] 파싱오류: ${e.message}`);
          resolve(null);
        }
      });
    }).on('error',e=>{
      console.log(`  ❌ [${label}] 네트워크오류: ${e.message}`);
      resolve(null);
    });
  });
}

function getSigunguCode(sido, sigungu){
  for(const f of fs.readdirSync(SPLIT_DIR).filter(f=>f.startsWith('coords_apt_')&&f.endsWith('.json'))){
    const data = JSON.parse(fs.readFileSync(path.join(SPLIT_DIR,f),'utf8'));
    const found = data.find(d=>d.sido===sido&&d.sigungu===sigungu);
    if(found) return found.sigunguCode||f.replace('coords_apt_','').replace('.json','');
  }
  return null;
}

// ── 5. 실행 ──────────────────────────────────────────────
(async()=>{
  let success=0, fail=0;
  const toAdd = {};

  for(const apt of targets){
    await new Promise(r=>setTimeout(r,200));

    // 도로명 먼저, 안되면 지번 재시도
    let geo = await geocode(apt.addrRoad, apt.name);
    if(!geo && apt.addrJibun && apt.addrJibun !== apt.addrRoad){
      console.log(`  🔄 [${apt.name}] 지번주소로 재시도: "${apt.addrJibun}"`);
      await new Promise(r=>setTimeout(r,200));
      geo = await geocode(apt.addrJibun, apt.name+' (지번)');
    }

    if(!geo){
      fail++;
      progress.done[apt.code] = `fail:주소없음|도로:${apt.addrRoad}|지번:${apt.addrJibun}`;
      continue;
    }

    const sigunguCode = getSigunguCode(apt.sido, apt.sigungu) || '99999';
    if(!toAdd[sigunguCode]) toAdd[sigunguCode]=[];
    toAdd[sigunguCode].push({
      code:apt.code, name:apt.name, lat:geo.lat, lng:geo.lng,
      units:apt.units, emd:apt.emd, sigunguCode,
      sido:apt.sido, sigungu:apt.sigungu,
      built:apt.built, dongCnt:apt.dongCnt, heat:apt.heat,
      sale:apt.sale, topFloor:apt.topFloor, addr:apt.addrRoad||apt.addrJibun,
      jibunAddr:apt.jibunAddr, builder:apt.builder,
      entrance:apt.entrance, totalPark:apt.totalPark,
      aptType:'아파트', mgrType:'',
    });
    progress.done[apt.code]='ok';
    success++;
    console.log(`  ✅ [${apt.name}] ${apt.sido} ${apt.sigungu} → (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})`);
  }

  // JSON 파일에 추가
  for(const [sc, apts] of Object.entries(toAdd)){
    const fp = path.join(SPLIT_DIR, `coords_apt_${sc}.json`);
    let existing = [];
    if(fs.existsSync(fp)) existing = JSON.parse(fs.readFileSync(fp,'utf8'));
    fs.writeFileSync(fp, JSON.stringify([...existing,...apts]),'utf8');
  }

  // coords_all_apt.json 갱신
  const allPath = path.join(SPLIT_DIR,'coords_all_apt.json');
  if(fs.existsSync(allPath)){
    const all = JSON.parse(fs.readFileSync(allPath,'utf8'));
    Object.values(toAdd).flat().forEach(a=>all.push(a));
    fs.writeFileSync(allPath, JSON.stringify(all),'utf8');
  }

  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress),'utf8');

  console.log(`\n완료! ✅ 성공:${success} ❌ 실패:${fail}`);

  if(fail>0){
    console.log('\n--- 최종 실패 목록 ---');
    Object.entries(progress.done).filter(([,v])=>v.startsWith('fail')).forEach(([code,reason])=>{
      console.log(`  ${code}: ${reason}`);
    });
  }

  if(success>0){
    console.log('\ngit add . && git commit -m "누락 아파트 추가(재시도)" && git push');
  }
})();
