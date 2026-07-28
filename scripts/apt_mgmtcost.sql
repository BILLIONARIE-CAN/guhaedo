-- 온디맨드 관리비 캐시 테이블 (api/mgmtcost.js 가 사용)
-- Supabase → SQL Editor 에 붙여넣고 실행하면 끝. (실거래가 apt_transactions 와 동일 패턴, RLS 없음)

create table if not exists apt_mgmtcost (
  kapt_code  text primary key,          -- 단지코드 (단지당 1행, 최신 상태)
  ym         text,                      -- 데이터 기준월 YYYYMM (없으면 '')
  total      bigint,                    -- 단지 전체 월 공용관리비 합계(원)
  per_hshld  integer,                   -- 세대당 월 공용관리비(원)
  detail     jsonb,                     -- [{label, amount}, ...] 17개 항목 내역
  fetched_at timestamptz default now()  -- 캐시 시각 (30일 지나면 다음 조회 때 재수집)
);

-- 서비스 키로 읽고/쓰기 (trade 캐시와 동일하게 RLS 미사용)
alter table apt_mgmtcost disable row level security;
