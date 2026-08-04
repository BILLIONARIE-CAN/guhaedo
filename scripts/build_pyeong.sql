-- =============================================================
--  단지별 평형대(9구간, 공급면적 기준) 도출
--  실거래 전용면적(apt_transactions.buy/jeonse/monthly[].a) →
--  공급평형 환산(전용률 0.75) → 10평 단위 9구간 버킷 →
--  단지별 존재 버킷 set 저장.
--  버킷: 0=10평미만 1=10평대 2=20평대 3=30평대 4=40평대
--        5=50평대 6=60평대 7=70평대 8=80평대~
--  Supabase → SQL Editor 에 전체 붙여넣고 Run. (몇 초 소요)
--  ※ 실거래 신규 반영 후 재실행하면 갱신됨.
-- =============================================================

-- 1) 단지별 버킷 테이블
create table if not exists apt_pyeong (
  kapt_code  text primary key,
  buckets    int[],                    -- 존재하는 평형대 인덱스(오름차순)
  updated_at timestamptz default now()
);
alter table apt_pyeong disable row level security;

-- 2) 집계 (전용→공급평형→버킷, 단지별 distinct)
insert into apt_pyeong (kapt_code, buckets)
select kapt_code, array_agg(distinct b order by b)
from (
  select t.kapt_code,
         least(8, greatest(0,
           floor( (x.elem->>'a')::numeric / 0.75 / 3.3058 / 10 )::int
         )) as b
  from apt_transactions t
  cross join lateral (
    select jsonb_array_elements(coalesce(t.buy,    '[]'::jsonb)) as elem
    union all
    select jsonb_array_elements(coalesce(t.jeonse, '[]'::jsonb))
    union all
    select jsonb_array_elements(coalesce(t.monthly,'[]'::jsonb))
  ) x
  where (x.elem->>'a') is not null
    and (x.elem->>'a')::numeric > 0
) s
group by kapt_code
on conflict (kapt_code) do update
  set buckets = excluded.buckets, updated_at = now();

-- 3) 클라이언트가 1회 요청으로 전부 받도록 단일 blob 로 합침
create table if not exists apt_pyeong_blob (
  id   int primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table apt_pyeong_blob disable row level security;

insert into apt_pyeong_blob (id, data)
select 1, jsonb_object_agg(kapt_code, buckets)
from apt_pyeong
on conflict (id) do update
  set data = excluded.data, updated_at = now();

-- 확인용:
-- select count(*) from apt_pyeong;                       -- 평형 있는 단지 수
-- select jsonb_object_keys(data) from apt_pyeong_blob limit 1;
