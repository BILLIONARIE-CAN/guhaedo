/**
 * 구해줘부동산 - 전국 아파트 좌표 생성 스크립트
 * 실행: "C:\Program Files\nodejs\node.exe" "%USERPROFILE%\Desktop\generate_coords.js"
 * 결과: coords.json 파일 생성 → GitHub guhaedo 저장소에 올리기
 */

const https = require('https');
const fs = require('fs');

const API_KEY = '8dfbbd6dc2fff98040507b95b9688bc24cbdfb35e253494d734a697d4658f1cf';
const KAKAO_KEY = 'be82d140cac4386ee76d82cc16c65c3e';

// 전국 시도 코드 (2자리)
const SIDO_CODES = [
  {code:'11', name:'서울'},
  {code:'26', name:'부산'},
  {code:'27', name:'대구'},
  {code:'28', name:'인천'},
  {code:'29', name:'광주'},
  {code:'30', name:'대전'},
  {code:'31', name:'울산'},
  {code:'36', name:'세종'},
  {code:'41', name:'경기'},
  {code:'43', name:'충북'},
  {code:'44', name:'충남'},
  {code:'45', name:'전북'},
  {code:'46', name:'전남'},
  {code:'47', name:'경북'},
  {code:'48', name:'경남'},
  {code:'51', name:'강원'},
  {code:'50', name:'제주'},
];

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    }).on('error', e => resolve(null));
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getCoords(address) {
  const encoded = encodeURIComponent(address);
  return new Promise((resolve) => {
    const options = {
      hostname: 'dapi.kakao.com',
      path: `/v2/local/search/address.json?query=${encoded}`,
      headers: { 'Authorization': `KakaoAK ${KAKAO_KEY}` }
    };
    https.get(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json?.documents?.length > 0) {
            resolve({ lat: parseFloat(json.documents[0].y), lng: parseFloat(json.documents[0].x) });
          } else resolve(null);
        } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function getAllAptsBySido(sidoCode, numOfRows=1000) {
  // 전체 개수 먼저 확인
  const firstUrl = `https://apis.data.go.kr/1613000/AptListService3/getSidoAptList3?serviceKey=${API_KEY}&sidoCode=${sidoCode}&numOfRows=1&pageNo=1&_type=json`;
  const first = await httpsGet(firstUrl);
  const total = first?.response?.body?.totalCount || 0;
  if (!total) return [];

  const pages = Math.ceil(total / numOfRows);
  let all = [];

  for (let p = 1; p <= pages; p++) {
    const url = `https://apis.data.go.kr/1613000/AptListService3/getSidoAptList3?serviceKey=${API_KEY}&sidoCode=${sidoCode}&numOfRows=${numOfRows}&pageNo=${p}&_type=json`;
    const json = await httpsGet(url);
    const items = json?.response?.body?.items;
    if (Array.isArray(items)) all = all.concat(items);
    else if (items && typeof items === 'object') all.push(items);
    await sleep(200);
  }
  return all.filter(x => x.kaptCode && x.kaptName && x.kaptName.trim() !== 'test001');
}

async function main() {
  console.log('🏢 전국 아파트 좌표 생성 시작...\n');

  // 기존 파일 로드 (이어서 처리)
  let result = [];
  let existing = {};
  if (fs.existsSync('coords.json')) {
    result = JSON.parse(fs.readFileSync('coords.json', 'utf8'));
    result.forEach(d => { existing[d.kaptCode] = true; });
    console.log(`기존 데이터 ${result.length}개 로드\n`);
  }

  let totalSuccess = 0;

  for (let i = 0; i < SIDO_CODES.length; i++) {
    const sido = SIDO_CODES[i];
    process.stdout.write(`[${i+1}/${SIDO_CODES.length}] ${sido.name} 단지 목록 조회중...`);

    const apts = await getAllAptsBySido(sido.code);
    console.log(` ${apts.length}개 단지`);

    let sidoSuccess = 0;
    for (let j = 0; j < apts.length; j++) {
      const item = apts[j];
      if (existing[item.kaptCode]) { sidoSuccess++; continue; }

      // 기본정보 조회
      const infoUrl = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${API_KEY}&kaptCode=${item.kaptCode}&_type=json`;
      const infoJson = await httpsGet(infoUrl);
      const info = infoJson?.response?.body?.item;

      const addr = info?.doroJuso || info?.kaptAddr ||
        [item.as1, item.as2, item.as3, item.as4].filter(Boolean).join(' ');
      if (!addr) { await sleep(80); continue; }

      // 좌표 변환
      const coords = await getCoords(addr);
      if (coords) {
        const d = {
          kaptCode: item.kaptCode,
          name: (info?.kaptName || item.kaptName || '').trim(),
          addr: addr,
          lat: coords.lat,
          lng: coords.lng,
          built: info?.kaptUsedate ? info.kaptUsedate.substring(0,4)+'년' : '',
          units: info?.kaptdaCnt ? info.kaptdaCnt+'세대' : '',
          sido: sido.name,
        };
        result.push(d);
        existing[item.kaptCode] = true;
        sidoSuccess++;
        totalSuccess++;
      }
      await sleep(80);

      // 진행상황 표시
      if (j % 50 === 0 && j > 0) {
        process.stdout.write(`  진행: ${j}/${apts.length} (성공 ${sidoSuccess}개)\r`);
      }

      // 200개마다 중간저장
      if (totalSuccess % 200 === 0 && totalSuccess > 0) {
        fs.writeFileSync('coords.json', JSON.stringify(result));
        console.log(`\n  💾 중간저장: 총 ${result.length}개`);
      }
    }
    console.log(`  ✅ ${sido.name} 완료: ${sidoSuccess}개 좌표`);
    await sleep(500);
  }

  // 최종 저장
  fs.writeFileSync('coords.json', JSON.stringify(result));
  console.log(`\n🎉 완료! 총 ${result.length}개 단지 coords.json 저장`);
  console.log('📤 GitHub guhaedo 저장소에 coords.json 업로드하세요!');
}

main().catch(console.error);
