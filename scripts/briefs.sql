-- 매물 브리핑 저장 (짧은 링크 + 카톡 미리보기용)
-- Supabase SQL Editor에 붙여넣고 Run.
create table if not exists briefs (
  id         text primary key,     -- 짧은 랜덤 ID (링크 a99.co.kr/b/{id})
  data       jsonb,                -- {b:중개사, i:[매물들]}
  created_at timestamptz default now()
);
alter table briefs disable row level security;   -- 익명 생성 + 서버 조회
