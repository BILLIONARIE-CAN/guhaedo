-- 단지 제보 테이블 (지도에 없거나 잘못된 단지를 사용자가 신고)
-- ✅ 2026-10-26 실행 완료.
--
-- ⚠️ 사고 기록: 이 파일은 2026-06-14 에 만들어졌지만 **한 번도 실행된 적이 없었다.**
--    그래서 손님이 제보 버튼을 눌러도 테이블이 없어 조용히 실패하고 있었다(4개월간).
--    "SQL 파일을 만들었다" 와 "슈파베이스에서 실행했다" 는 다른 일이다. 반드시 확인할 것.

create table if not exists public.apt_reports (
  id          uuid primary key default gen_random_uuid(),
  apt_name    text not null,          -- 단지명 (필수)
  addr        text,                   -- 위치/주소 (선택)
  memo        text,                   -- 메모 (예: "지도에 없어요", "1차/2차가 한 핀")
  status      text default 'new',     -- new(신규) / done(처리됨)
  created_at  timestamptz default now()
);

create index if not exists apt_reports_created_idx on public.apt_reports (created_at desc);

-- RLS: 넣기만 허용. 읽기 정책 없음 = 손님이 쓴 내용을 아무나 못 읽는다.
-- (원래 파일엔 anon 읽기 정책도 있었지만, 손님이 뭘 적을지 모르므로 뺐다.
--  조회는 슈파베이스 대시보드나 서버에서 — service_role 은 RLS 를 통과한다)
alter table public.apt_reports enable row level security;
create policy apt_reports_insert on public.apt_reports
  for insert to anon, authenticated with check (true);
