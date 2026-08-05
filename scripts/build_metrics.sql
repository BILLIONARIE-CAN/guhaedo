-- =============================================================
--  apt_metrics — 단지별 필터 지표(서버측 필터용, 아실 방식)
--  실거래(apt_transactions) 기반 값 계산 → 지도 뷰포트+필터 쿼리에 사용.
--  대표값 정의: 최근 18개월 · 일반매매(분양권 제외) · 대표평형(최빈 전용㎡) 기준.
--  Supabase SQL Editor 전체 붙여넣고 Run. (실거래 갱신되면 재실행)
--  ※ lat/lng/units/movein/name/dong 은 coords 파일에서 별도 import (이 SQL은 실거래 지표만).
-- =============================================================

create table if not exists apt_metrics (
  kapt_code   text primary key,
  lat         double precision,   -- coords import
  lng         double precision,   -- coords import
  dong        text,               -- coords import (법정동코드)
  name        text,               -- coords import
  units       integer,            -- coords import (세대수)
  movein      integer,            -- coords import (입주년)
  rep_area_m2 numeric,            -- 대표평형(전용㎡)
  price_m     bigint,             -- 대표 매매가(만원)
  py_m        integer,            -- 평당가(만원/평, 공급면적)
  jeonse_m    bigint,             -- 대표 전세가(만원)
  j_rate      integer,            -- 전세가율(%)
  gap_m       bigint,             -- 매매전세갭(만원)
  deal_cnt    integer,            -- 최근18개월 매매 건수(회전율용)
  updated_at  timestamptz default now()
);
alter table apt_metrics disable row level security;

with cut as (select to_char(now() - interval '18 months','YYYYMM')::int as ym),
buys as (
  select t.kapt_code,
         round((e->>'a')::numeric) as ar,
         (e->>'p')::bigint as p,
         replace((e->>'t'),'-','')::int as ym,
         nullif(regexp_replace((e->>'day'),'[^0-9]','','g'),'')::int as d
  from apt_transactions t
  cross join lateral jsonb_array_elements(coalesce(t.buy,'[]'::jsonb)) as e
  where (e->>'pre') is null                       -- 일반매매만(분양권/입주권 제외)
    and (e->>'a') is not null and (e->>'a')::numeric > 0
    and replace((e->>'t'),'-','')::int >= (select ym from cut)
),
rep as (
  select kapt_code,
         mode() within group (order by ar) as rep_ar,   -- 대표평형(최빈 전용㎡)
         count(*) as deal_cnt
  from buys group by kapt_code
),
repprice as (
  select distinct on (b.kapt_code)
         b.kapt_code, r.rep_ar, r.deal_cnt, b.p as price_m
  from buys b join rep r on r.kapt_code=b.kapt_code and b.ar=r.rep_ar
  order by b.kapt_code, b.ym desc, b.d desc nulls last  -- 대표평형 최신 거래
),
jeon as (
  select t.kapt_code,
         round((e->>'a')::numeric) as ar,
         (e->>'p')::bigint as p,
         replace((e->>'t'),'-','')::int as ym,
         nullif(regexp_replace((e->>'day'),'[^0-9]','','g'),'')::int as d
  from apt_transactions t
  cross join lateral jsonb_array_elements(coalesce(t.jeonse,'[]'::jsonb)) as e
  where (e->>'a') is not null and (e->>'a')::numeric > 0
    and replace((e->>'t'),'-','')::int >= (select ym from cut)
),
repjeon as (
  select distinct on (j.kapt_code) j.kapt_code, j.p as jeonse_m
  from jeon j join repprice p on p.kapt_code=j.kapt_code and j.ar=p.rep_ar
  order by j.kapt_code, j.ym desc, j.d desc nulls last  -- 대표평형 최신 전세
)
insert into apt_metrics (kapt_code, rep_area_m2, price_m, py_m, jeonse_m, j_rate, gap_m, deal_cnt, updated_at)
select p.kapt_code,
       p.rep_ar,
       p.price_m,
       round(p.price_m / (p.rep_ar/0.75/3.3058))::int as py_m,
       rj.jeonse_m,
       case when rj.jeonse_m is not null and p.price_m>0
            then round(rj.jeonse_m::numeric/p.price_m*100)::int end as j_rate,
       case when rj.jeonse_m is not null then p.price_m - rj.jeonse_m end as gap_m,
       p.deal_cnt,
       now()
from repprice p
left join repjeon rj on rj.kapt_code=p.kapt_code
on conflict (kapt_code) do update set
  rep_area_m2=excluded.rep_area_m2, price_m=excluded.price_m, py_m=excluded.py_m,
  jeonse_m=excluded.jeonse_m, j_rate=excluded.j_rate, gap_m=excluded.gap_m,
  deal_cnt=excluded.deal_cnt, updated_at=now();

-- 확인
select count(*) as 지표단지수,
       round(avg(price_m)) as 평균매매가_만원,
       round(avg(py_m))   as 평균평당가_만원,
       round(avg(j_rate)) as 평균전세가율
from apt_metrics where price_m is not null;
