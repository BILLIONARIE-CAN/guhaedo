-- =============================================================
--  apt_metrics — 단지별 필터 지표(서버측 필터용, 아실 방식)
--  실거래(apt_transactions) 기반 값 계산 → 지도 뷰포트+필터 쿼리에 사용.
--  대표값 정의: 최근 18개월 · 일반매매(분양권 제외) · 대표평형 기준.
--  Supabase SQL Editor 전체 붙여넣고 Run. (실거래 갱신되면 재실행)
--  ※ lat/lng/units/movein/name/dong 은 coords 파일에서 별도 import (이 SQL은 실거래 지표만).
--
--  [2026-09-02 변경] 대표평형 '밴드 가드' 추가
--   - 문제: 대표평형이 '거래 최빈 면적'이라, 소형 거래가 잦은 혼합단지에서
--           소수 평형이 대표로 잡힘. (예: 아산한라비발디스마트밸리 —
--           세대수 60㎡↓ 244(24%) / 60~85㎡ 754(76%) 인데 대표가 55㎡)
--   - 해결: 세대수 최다 밴드 '안에서' 최빈을 고름. 그 밴드에 거래가 없으면
--           기존처럼 전체 최빈으로 폴백(동작 안 바뀜).
--   - ⚠️ 선행: scripts/build_area_break.sql 을 먼저 실행해 apt_area_break 생성.
--             없으면 가드가 통째로 폴백되어 예전과 동일하게 동작(에러 아님).
--   - 참고: 전 세대가 소형인 단지(예: 배방삼정그린코아 u60=2156, 100%)는
--           원래 대표 38㎡가 정답 — 가드가 건드리지 않음.
--  [2026-09-02 추가] turn_rate(거래회전율) · far/bcr(용적률/건폐율) 컬럼
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
  gap_m       bigint,             -- 매매전세갭(만원). 음수=역전세
  deal_cnt    integer,            -- 최근18개월 매매 건수(회전율용)
  updated_at  timestamptz default now()
);
alter table apt_metrics disable row level security;

-- 신규 컬럼 (있으면 무시)
alter table apt_metrics add column if not exists turn_rate numeric;  -- 거래회전율 %: deal_cnt / units * 100 (18개월 기준)
alter table apt_metrics add column if not exists far       numeric;  -- 용적률 % (apartments에서 복사)
alter table apt_metrics add column if not exists bcr       numeric;  -- 건폐율 % (apartments에서 복사)

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
-- 세대수 최다 평형 밴드 (전용㎡ 구간). apt_area_break 없으면 이 CTE가 비어 폴백됨.
band as (
  select kapt_code,
         case greatest(u60,u85,u135,o135)
           when u60 then 0 when u85 then 60 when u135 then 85 else 135 end as lo,
         case greatest(u60,u85,u135,o135)
           when u60 then 60 when u85 then 85 when u135 then 135 else 100000 end as hi,
         units as units_ab
  from apt_area_break
  where units > 0
),
rep as (
  select b.kapt_code,
         coalesce(
           -- ① 주력 밴드 안에서 최빈 (밴드 가드)
           mode() within group (order by b.ar)
             filter (where bd.lo is not null and b.ar >= bd.lo and b.ar < bd.hi),
           -- ② 밴드에 거래가 없거나 apt_area_break에 없으면 전체 최빈(기존 동작)
           mode() within group (order by b.ar)
         ) as rep_ar,
         count(*) as deal_cnt,
         max(bd.units_ab) as units_ab
  from buys b
  left join band bd on bd.kapt_code = b.kapt_code
  group by b.kapt_code
),
repprice as (
  select distinct on (b.kapt_code)
         b.kapt_code, r.rep_ar, r.deal_cnt, r.units_ab, b.p as price_m
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
insert into apt_metrics (kapt_code, rep_area_m2, price_m, py_m, jeonse_m, j_rate, gap_m, deal_cnt, turn_rate, updated_at)
select p.kapt_code,
       p.rep_ar,
       p.price_m,
       round(p.price_m / (p.rep_ar/0.75/3.3058))::int as py_m,
       rj.jeonse_m,
       case when rj.jeonse_m is not null and p.price_m>0
            then round(rj.jeonse_m::numeric/p.price_m*100)::int end as j_rate,
       -- 음수 = 역전세(전세가 매매가보다 높음). 화면에서 지우지 말 것.
       case when rj.jeonse_m is not null then p.price_m - rj.jeonse_m end as gap_m,
       p.deal_cnt,
       case when coalesce(p.units_ab,0) > 0
            then round(p.deal_cnt::numeric / p.units_ab * 100, 1) end as turn_rate,
       now()
from repprice p
left join repjeon rj on rj.kapt_code=p.kapt_code
on conflict (kapt_code) do update set
  rep_area_m2=excluded.rep_area_m2, price_m=excluded.price_m, py_m=excluded.py_m,
  jeonse_m=excluded.jeonse_m, j_rate=excluded.j_rate, gap_m=excluded.gap_m,
  deal_cnt=excluded.deal_cnt, turn_rate=excluded.turn_rate, updated_at=now();

-- apt_area_break에 없던 단지는 apt_metrics.units(coords import)로 회전율 보완
update apt_metrics
   set turn_rate = round(deal_cnt::numeric / units * 100, 1)
 where turn_rate is null and deal_cnt is not null and coalesce(units,0) > 0;

-- 용적률/건폐율 복사 (핀 표시모드·필터용)
update apt_metrics m
   set far = a.far, bcr = a.bcr
  from apartments a
 where a.kapt_code = m.kapt_code
   and (a.far is not null or a.bcr is not null);

-- 확인
select count(*) as 지표단지수,
       round(avg(price_m)) as 평균매매가_만원,
       round(avg(py_m))    as 평균평당가_만원,
       round(avg(j_rate))  as 평균전세가율,
       count(*) filter (where gap_m < 0)   as 역전세단지수,
       round(avg(turn_rate),1) as 평균회전율_18개월,
       count(*) filter (where far is not null) as 용적률보유
from apt_metrics where price_m is not null;

-- 밴드 가드가 실제로 바꾼 단지 확인 (대표평형이 주력 밴드 안에 들어왔는지)
select count(*) as 가드적용_확인
from apt_metrics m join apt_area_break b on b.kapt_code = m.kapt_code
where m.rep_area_m2 is not null
  and m.rep_area_m2 >= (case greatest(b.u60,b.u85,b.u135,b.o135)
        when b.u60 then 0 when b.u85 then 60 when b.u135 then 85 else 135 end)
  and m.rep_area_m2 <  (case greatest(b.u60,b.u85,b.u135,b.o135)
        when b.u60 then 60 when b.u85 then 85 when b.u135 then 135 else 100000 end);
