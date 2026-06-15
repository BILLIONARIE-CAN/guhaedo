-- 단지 제보 테이블 (지도에 없거나 잘못된 단지를 사용자가 신고)
-- Supabase → SQL Editor 에 붙여넣고 한 번 실행하면 됩니다.

create table if not exists apt_reports (
  id          uuid primary key default gen_random_uuid(),
  apt_name    text not null,          -- 단지명 (필수)
  addr        text,                   -- 위치/주소 (선택)
  memo        text,                   -- 메모 (예: "지도에 없어요", "1차/2차가 한 핀")
  status      text default 'new',     -- new(신규) / done(처리됨)
  created_at  timestamptz default now()
);

-- 최신 제보부터 보기 편하도록 인덱스
create index if not exists apt_reports_created_idx on apt_reports (created_at desc);

-- RLS: 사이트 방문자(anon)가 제보 등록/조회 가능. 개인정보(연락처)는 수집하지 않음.
alter table apt_reports enable row level security;

create policy "anon insert reports" on apt_reports
  for insert to anon with check (true);

create policy "anon read reports" on apt_reports
  for select to anon using (true);
