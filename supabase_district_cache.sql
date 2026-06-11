-- 시군구별 실거래 캐시 테이블 (마스터 진단용)
-- Supabase 대시보드 → SQL Editor → 이 내용 붙여넣고 Run

create table if not exists district_cache (
  lawd_cd text not null,
  ym text not null,
  buy jsonb,
  rent jsonb,
  pre jsonb,
  fetched_at timestamptz default now(),
  primary key (lawd_cd, ym)
);

-- 서버(service key)만 접근하므로 RLS로 외부 접근 차단
alter table district_cache enable row level security;
