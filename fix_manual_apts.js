/**
 * fix_manual_apts.js
 * retry에서 실패한 15개를 주소 보정 후 재시도합니다.
 * - 콤마 주소 → 첫 번째만 사용
 * - 화성만세구/효행구/동탄구 → 화성시로 변환
 * - 포항북구/남구 → 포항시 북구/남구로 변환
 * - 번지 없는 주소 → 단지명으로 카카오 키워드 검색
 *
 * 사용법: node fix_manual_apts.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const KAKAO_KEY     = 'be82d140cac4386ee76d82cc16c65c3e';
const SPLIT_DIR     = path.join(__dirname, 'split_output');
const PROGRESS_PATH = path.join(__dirname, 'progress_missing.json');

// ── 수동 보정 데이터 ─────────────────────────────────────
// [code, name, 검색어(주소 or 단지명), sido, sigungu, emd, 나머지필드]
const MANUAL = [
  // 1. 콤마 주소 → 첫 번째만
  { code:'A13511101', name:'압구정 현대(10,13,14차)',
    searchAddr:'서울특별시 강남구 압구정로29길 69',
    sido:'서울특별시', sigungu:'강남구', emd:'압구정동',
    units:2424, entrance:'계단식', builder:'현대건설', totalPark:1020, dongCnt:'17동', topFloor:15, heat:'개별난방', sale:'분양', built:'1978.09' },

  { code:'A13895502', name:'가락3차쌍용스윗닷홈(1~4동)',
    searchAddr:'서울특별시 송파구 송이로19길 15',
    sido:'서울특별시', sigungu:'송파구', emd:'가락동',
    units:430, entrance:'계단식', builder:'쌍용건설', totalPark:195, dongCnt:'4동', topFloor:15, heat:'개별난방', sale:'분양', built:'2004.11' },

  { code:'A42780601', name:'과천주공10단지',
    searchAddr:'경기도 과천시 관문로 166',
    sido:'경기도', sigungu:'과천시', emd:'중앙동',
    units:1980, entrance:'계단식', builder:'', totalPark:0, dongCnt:'18동', topFloor:15, heat:'중앙난방', sale:'분양', built:'1985.08' },

  // 2. 주소 없음 → 단지명으로 키워드 검색
  { code:'A10020070', name:'한화포레나 월평공원1단지아파트',
    searchAddr:'대전 서구 정림동 한화포레나 월평공원1단지',
    sido:'대전광역시', sigungu:'서구', emd:'정림동',
    units:998, entrance:'계단식', builder:'한화건설', totalPark:1200, dongCnt:'8동', topFloor:29, heat:'지역난방', sale:'분양', built:'2023.10' },

  { code:'A10022542', name:'과천리오포레데시앙',
    searchAddr:'경기도 과천시 갈현동 과천리오포레',
    sido:'경기도', sigungu:'과천시', emd:'갈현동',
    units:0, entrance:'', builder:'', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  // 3. 화성 분구 → 화성시로 변환
  { code:'A10020624', name:'LH 향남 2지구 22단지',
    searchAddr:'경기도 화성시 향남읍 하길리 LH향남2지구',
    sido:'경기도', sigungu:'화성시', emd:'향남읍',
    units:0, entrance:'', builder:'LH', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'임대', built:'' },

  { code:'A10020631', name:'향남21단지',
    searchAddr:'경기도 화성시 향남읍 하길리 향남21단지',
    sido:'경기도', sigungu:'화성시', emd:'향남읍',
    units:0, entrance:'', builder:'', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  { code:'A10020589', name:'봉담자이라젠느',
    searchAddr:'경기도 화성시 봉담읍 봉담자이라젠느',
    sido:'경기도', sigungu:'화성시', emd:'봉담읍',
    units:0, entrance:'', builder:'GS건설', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  { code:'A10020548', name:'동탄 파크릭스 A52BL',
    searchAddr:'경기도 화성시 동탄 파크릭스',
    sido:'경기도', sigungu:'화성시', emd:'신동',
    units:0, entrance:'', builder:'', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  { code:'A10020518', name:'동탄 파크릭스 A55BL 아파트',
    searchAddr:'경기도 화성시 동탄신도시 파크릭스',
    sido:'경기도', sigungu:'화성시', emd:'신동',
    units:0, entrance:'', builder:'', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  { code:'A10020532', name:'동탄숨마데시앙',
    searchAddr:'경기도 화성시 동탄 숨마데시앙',
    sido:'경기도', sigungu:'화성시', emd:'신동',
    units:0, entrance:'', builder:'태영건설', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  { code:'A10020523', name:'동탄아테라파밀리에',
    searchAddr:'경기도 화성시 동탄 아테라파밀리에',
    sido:'경기도', sigungu:'화성시', emd:'신동',
    units:0, entrance:'', builder:'', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  // 4. 기타 주소 없음
  { code:'A10020748', name:'장흥역 경남아너스빌 북한산뷰5블럭',
    searchAddr:'경기도 양주시 장흥면 장흥역 경남아너스빌 북한산뷰',
    sido:'경기도', sigungu:'양주시', emd:'장흥면',
    units:0, entrance:'', builder:'경남기업', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  { code:'A10021706', name:'전곡조흥아파트',
    searchAddr:'경기도 연천군 전곡읍 전곡리 전곡조흥아파트',
    sido:'경기도', sigungu:'연천군', emd:'전곡읍',
    units:0, entrance:'', builder:'', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },

  // 5. 포항북구 → 포항시로 변환
  { code:'A10020063', name:'포항학산한신더휴엘리트파크',
    searchAddr:'경상북도 포항시 북구 학산동 포항학산한신더휴',
    sido:'경상북도', sigungu:'포항시 북구', emd:'학산동',
    units:0, entrance:'계단식', builder:'한신공영', totalPark:0, dongCnt:'', topFloor:0, heat:'', sale:'분양', built:'' },
];

// ── 지오코딩 (주소검색 + 키워드검색 순서로) ──────────────
function request(url){
  return new Promise(resolve=>{
    https.get(url, {headers:{'Authorization':'KakaoAK '+KAKAO_KEY}}, res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{ resolve(JSON.parse(d)); }catch(e){ resolve(null); } });
    }).on('error',()=>resolve(null));
  });
}

async function geocode(apt){
  // 1. 주소 검색
  const r1 = await request('https://dapi.kakao.com/v2/local/search/address.json?query='+encodeURIComponent(apt.searchAddr));
  if(r1?.documents?.length>0){
    return {lat:parseFloat(r1.documents[0].y), lng:parseFloat(r1.documents[0].x)};
  }
  // 2. 키워드 검색 (단지명)
  await new Promise(r=>setTimeout(r,150));
  const r2 = await request('https://dapi.kakao.com/v2/local/search/keyword.json?query='+encodeURIComponent(apt.name)+'&category_group_code=SW8');
  if(r2?.documents?.length>0){
    return {lat:parseFloat(r2.documents[0].y), lng:parseFloat(r2.documents[0].x)};
  }
  return null;
}

function getSigunguCode(sido, sigungu){
  for(const f of fs.readdirSync(SPLIT_DIR).filter(f=>f.startsWith('coords_apt_')&&f.endsWith('.json'))){
    const data = JSON.parse(fs.readFileSync(path.join(SPLIT_DIR,f),'utf8'));
    const found = data.find(d=>d.sido===sido&&d.sigungu===sigungu);
    if(found) return found.sigunguCode||f.replace('coords_apt_','').replace('.json','');
  }
  return null;
}

(async()=>{
  const progress = fs.existsSync(PROGRESS_PATH)
    ? JSON.parse(fs.readFileSync(PROGRESS_PATH,'utf8'))
    : {done:{}};

  let success=0, fail=0;
  const toAdd = {};

  for(const apt of MANUAL){
    await new Promise(r=>setTimeout(r,200));
    const geo = await geocode(apt);

    if(!geo){
      console.log(`❌ [${apt.name}] 실패 | 검색어: "${apt.searchAddr}"`);
      progress.done[apt.code] = 'fail:manual도실패';
      fail++;
      continue;
    }

    const sc = getSigunguCode(apt.sido, apt.sigungu) || '99999';
    if(!toAdd[sc]) toAdd[sc]=[];
    toAdd[sc].push({
      code:apt.code, name:apt.name, lat:geo.lat, lng:geo.lng,
      units:apt.units, emd:apt.emd, sigunguCode:sc,
      sido:apt.sido, sigungu:apt.sigungu,
      built:apt.built, dongCnt:apt.dongCnt, heat:apt.heat,
      sale:apt.sale, topFloor:apt.topFloor, addr:apt.searchAddr,
      jibunAddr:'', builder:apt.builder, entrance:apt.entrance,
      totalPark:apt.totalPark, aptType:'아파트', mgrType:'',
    });
    progress.done[apt.code]='ok';
    success++;
    console.log(`✅ [${apt.name}] → (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})`);
  }

  for(const [sc, apts] of Object.entries(toAdd)){
    const fp = path.join(SPLIT_DIR,`coords_apt_${sc}.json`);
    let existing = [];
    if(fs.existsSync(fp)) existing = JSON.parse(fs.readFileSync(fp,'utf8'));
    fs.writeFileSync(fp, JSON.stringify([...existing,...apts]),'utf8');
  }

  const allPath = path.join(SPLIT_DIR,'coords_all_apt.json');
  if(fs.existsSync(allPath)){
    const all = JSON.parse(fs.readFileSync(allPath,'utf8'));
    Object.values(toAdd).flat().forEach(a=>all.push(a));
    fs.writeFileSync(allPath, JSON.stringify(all),'utf8');
  }

  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress),'utf8');
  console.log(`\n완료! ✅ 성공:${success} ❌ 실패:${fail}`);
  if(success>0) console.log('\ngit add . && git commit -m "누락 아파트 수동보정 추가" && git push');
})();
