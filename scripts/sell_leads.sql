-- 집내놓기(매물 접수) 저장 테이블
-- Supabase → SQL Editor에 붙여넣고 실행하면 끝. (단지제보 apt_reports와 동일 패턴: 익명 insert 허용, 조회는 관리자만)

create table if not exists sell_leads (
  id            bigint generated always as identity primary key,
  name          text,   -- 성함
  tel           text,   -- 연락처
  apt_name      text,   -- 단지명(선택된)
  kapt_code     text,   -- 단지코드 → 나중에 broker_apts로 담당 협력중개사 매칭용
  sido          text,
  sigungu       text,
  emd           text,
  dong_ho       text,   -- 동/호수
  unit_type     text,   -- 타입(84A 등)
  floor         text,
  direction     text,   -- 거실 방향
  deal_type     text,   -- 매매/전세/월세
  price_sale    text,
  price_jeonse  text,
  price_monthly text,
  memo          text,   -- 특이사항
  status        text default 'new',   -- new → (나중에) assigned/contacted 등
  created_at    timestamptz default now()
);

-- RLS: 익명(손님)은 등록만 가능, 조회는 관리자(service key/대시보드)만
alter table sell_leads enable row level security;
create policy sell_leads_anon_insert on sell_leads for insert to anon with check (true);

-- 관리자 확인: Supabase 대시보드 → Table Editor → sell_leads 에서 최신순(created_at desc)으로 보면 됨.
-- 나중에 담당 중개사 라우팅: kapt_code로 broker_apts(단지↔중개사) 조인 → 담당 있으면 그 brokers에게 알림.
