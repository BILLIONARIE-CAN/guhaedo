-- =============================================================
--  RLS 1차 — 공개 데이터 테이블 잠그기 (2026-10-26)
--
--  ⚠️ 반드시 Supabase SQL Editor 에서 "Run without RLS" 로 실행할 것.
--
--  [선행조건 — 이미 완료됨]
--  Vercel 환경변수 SUPABASE_KEY 가 service_role 로 교체돼 있어야 한다.
--  anon 급이면 이걸 켜는 순간 워밍·수집·캐시 쓰기가 전부 죽는다.
--
--  [실행 완료 — 2026-10-26, 전부 검증됨]
--  Supabase SQL Editor 는 drop policy / alter table 을 '위험한 작업'으로 보고 확인창을 띄운다.
--  정책을 처음 만드는 것이라 drop 은 필요 없어서 뺐다. 다시 돌릴 땐 이름 충돌에 주의.
--
--  [방침]
--  브라우저(공개 anon 키) = 읽기만.  쓰기는 서버(service_role)만.
--  anon 키는 index.html 에 박혀 공개되는 게 정상이다. 문제는 그 키로
--  지금까지 UPDATE/DELETE 까지 됐다는 것 — 작정하면 단지 2.5만 개를
--  통째로 지울 수 있었다. 유출보다 '파괴'가 위험하다.
--
--  [2차에서 할 것 — 여기 없는 이유]
--  brokers / businesses / banners / broker_apts / apt_fix 는
--  admin-vkz·aptfix-vkz 페이지가 **브라우저에서 직접** POST/PATCH/DELETE 한다.
--  지금 잠그면 사무소·전문중개사·배너 관리가 통째로 먹통이 된다.
--  그 쓰기들을 서버 경유로 바꾼 뒤에 잠근다.
--  (⚠️ 인수인계서 v23 의 '브라우저 직접 쓰기' 목록에 관리자 페이지가 빠져 있었다)
-- =============================================================

-- ── 1) 공개 데이터: 읽기만 허용 ──────────────────────────────
alter table public.apt_map          enable row level security;
alter table public.apt_metrics      enable row level security;
alter table public.apt_transactions enable row level security;
alter table public.apartments       enable row level security;
alter table public.apt_pyeong       enable row level security;
alter table public.apt_pyeong_blob  enable row level security;
alter table public.apt_area_break   enable row level security;
alter table public.apt_mgmtcost     enable row level security;

create policy apt_map_read on public.apt_map for select to anon, authenticated using (true);

create policy apt_metrics_read on public.apt_metrics for select to anon, authenticated using (true);

create policy apt_transactions_read on public.apt_transactions for select to anon, authenticated using (true);

create policy apartments_read on public.apartments for select to anon, authenticated using (true);

create policy apt_pyeong_read on public.apt_pyeong for select to anon, authenticated using (true);

create policy apt_pyeong_blob_read on public.apt_pyeong_blob for select to anon, authenticated using (true);

create policy apt_area_break_read on public.apt_area_break for select to anon, authenticated using (true);

create policy apt_mgmtcost_read on public.apt_mgmtcost for select to anon, authenticated using (true);

-- ── 2) 손님이 넣는 테이블: 넣기만 허용, 고치기·지우기 금지 ──
--    update/delete 정책이 없으면 그 동작은 아예 막힌다.
--    (남이 남의 제보·문의를 지우지 못하게)

-- briefs: 매물 브리핑 짧은링크(/b/{id}) — 읽기 필요 + 넣기 필요
alter table public.briefs enable row level security;
create policy briefs_read on public.briefs for select to anon, authenticated using (true);
create policy briefs_insert on public.briefs for insert to anon, authenticated with check (true);

-- sell_leads: 집내놓기 문의 = 개인정보.
-- ⚠️ 지금까지 공개 키로 '아무나 읽을 수' 있었다(다행히 0건이라 샌 건 없음).
--    넣기만 허용하고 읽기 정책은 주지 않는다 → 조회는 서버/관리자만.
alter table public.sell_leads enable row level security;
create policy sell_leads_insert on public.sell_leads for insert to anon, authenticated with check (true);

-- ── 3) 서버 전용: 정책 없음 = 브라우저에서 아예 접근 불가 ──
alter table public.warm_state enable row level security;
-- ⚠️ 상태페이지(/api/warm?status=1)는 서버가 service_role 로 읽으므로 그대로 동작한다.
-- ⚠️ scripts/discover_browser.js 는 브라우저에서 apt_map INSERT + briefs UPSERT 를
--    하므로 이제 안 된다. 쓸 일이 생기면 api/diag.js 에 op 를 추가해 서버 경유로 바꿀 것.
--    (새 서버리스 파일 금지 — Vercel 함수 12개 한도)
