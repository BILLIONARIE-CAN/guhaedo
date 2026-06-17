-- 아파트 단지 수정(보강) 작업대 저장 테이블
-- Supabase → SQL Editor 에 붙여넣고 실행.
-- 원본 데이터는 그대로 두고, '고친 값'만 여기 저장 → 지도가 원본 위에 덮어씀(되돌리기 = 행 삭제)

create table if not exists apt_fix (
  kapt_code   text primary key,        -- 단지코드
  lat         float8,                  -- 보정 위도(핀 드래그)
  lng         float8,                  -- 보정 경도
  units       text,                    -- 세대수 (모르면 '-')
  built       text,                    -- 준공
  dong_cnt    text,                    -- 동수
  top_floor   text,                    -- 최고층
  heat        text,                    -- 난방
  builder     text,                    -- 시공사
  entrance    text,                    -- 현관구조
  total_park  text,                    -- 총주차
  addr        text,                    -- 주소
  name        text,                    -- 단지명 (이름 보정 / 추가단지 이름)
  is_added    boolean default false,   -- 분리·추가한 단지인가 (원본에 없던 2·3단지)
  parent_code text,                    -- (추가단지) 원래 합쳐져 있던 단지코드
  region_code text,                    -- (추가단지) 시군구코드 (목록 표시용)
  problem     boolean default false,   -- ❗안됨(문제) 체크 — 나중에 같이 수정
  memo        text,                    -- 문제 내용/메모
  status      text default 'done',     -- done = 작업완료
  updated_at  timestamptz default now()
);

create index if not exists apt_fix_problem_idx on apt_fix (problem);

-- RLS: 작업대(비번 뒤)에서 anon 키로 읽기/저장. (정식 Auth 연동 전까지 임시)
alter table apt_fix enable row level security;
create policy "anon read apt_fix"   on apt_fix for select to anon using (true);
create policy "anon insert apt_fix" on apt_fix for insert to anon with check (true);
create policy "anon update apt_fix" on apt_fix for update to anon using (true) with check (true);
