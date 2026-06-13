// bjdCode 저장 여부 확인
// 실행: cd C:\Users\essoz\GitHub\guhaedo && node check_bjdcode.js

const SUPABASE_URL = 'https://nqnbbccazjanjhktknyz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbmJiY2Nhemphbmpoa3Rrbnl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0OTA5NDQsImV4cCI6MjA5NTA2Njk0NH0.rT_hIwTJyBnCDGyudmJYvN44G67WgZ9-bSVCzShiRjI';
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function main() {
  // 컬럼 존재 여부 + 값 채움 현황 확인
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apartments?select=*&limit=1`,
    { headers }
  );
  const data = await r.json();
  console.log('컬럼 목록:', Object.keys(data[0] || {}).join(', '));
}

main().catch(console.error);
