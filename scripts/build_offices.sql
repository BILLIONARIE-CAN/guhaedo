-- ============================================================
-- 아구구 사무소(중개사무소) 등록 테이블 + 저장 함수
-- Supabase SQL Editor에 붙여넣고 Run
-- ⚠️ 반드시 "Run without RLS" 로 실행 (기존 테이블 RLS 켜지면 지도 깨짐)
-- ============================================================

-- 1) 사무소 테이블 ------------------------------------------------
create table if not exists public.offices (
  id            bigserial primary key,
  name          text not null,              -- 상호 (사무소명)
  ceo           text,                       -- 대표자 성명
  biz_no        text,                       -- 사업자등록번호
  reg_no        text,                       -- 중개사무소 등록번호
  addr          text,                       -- 사무소 주소
  tel           text,                       -- 대표 전화
  email         text,                       -- 이메일
  hours         text,                       -- 영업시간 (예: 평일 09:00~18:00)
  intro         text,                       -- 소개글 (여러 줄 가능)
  kakao_url     text,                       -- 카카오톡 채널 등 (선택)
  is_primary    boolean default false,      -- 대표 사무소 = /about, /contact 에 노출
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 대표 사무소는 하나만
create unique index if not exists offices_primary_uniq
  on public.offices ((is_primary)) where is_primary;

-- 2) 관리자 비밀번호 보관 (앱 코드에 비번을 박지 않기 위함) --------
create extension if not exists pgcrypto;

create table if not exists public.admin_secret (
  id      int primary key default 1,
  pw_hash text not null,
  constraint admin_secret_one_row check (id = 1)
);

-- 2.5) 활동 로그 (누가 언제 무엇을 바꿨나) -------------------------
--  ⚠️ 지금은 계정이 없으므로 actor 는 '관리자' 로만 기록된다.
--     계정 시스템(아이디+비번)이 붙으면 actor 에 사용자 아이디를 넣으면 된다.
create table if not exists public.audit_log (
  id         bigserial primary key,
  at         timestamptz default now(),
  actor      text,
  action     text,
  target     text,
  target_id  text,
  detail     jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- 3) 권한: 공개 읽기만 허용, 쓰기는 아래 함수로만 -------------------
alter table public.offices      enable row level security;
alter table public.admin_secret enable row level security;
alter table public.audit_log    enable row level security;
-- audit_log 정책 없음 = 브라우저에서 직접 못 읽음. 조회는 read_audit_log(pw) 로만.

drop policy if exists offices_public_read on public.offices;
create policy offices_public_read on public.offices
  for select to anon, authenticated using (true);
-- offices 에 insert/update/delete 정책 없음 = 브라우저에서 직접 못 씀
-- admin_secret 는 정책 자체가 없음 = 브라우저에서 아예 못 읽음

-- 4) 비밀번호 설정 함수 (최초 1회 + 변경할 때) ----------------------
create or replace function public.set_admin_pw(p_old text, p_new text)
returns text language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if length(coalesce(p_new,'')) < 8 then
    return '실패: 새 비밀번호는 8자 이상이어야 합니다.';
  end if;
  select pw_hash into cur from admin_secret where id = 1;
  if cur is null then
    insert into admin_secret(id, pw_hash) values (1, crypt(p_new, gen_salt('bf')));
    return '완료: 비밀번호가 설정되었습니다.';
  end if;
  if cur <> crypt(coalesce(p_old,''), cur) then
    return '실패: 기존 비밀번호가 맞지 않습니다.';
  end if;
  update admin_secret set pw_hash = crypt(p_new, gen_salt('bf')) where id = 1;
  insert into audit_log(actor, action, target) values ('관리자', 'admin.pw', '비밀번호 변경');
  return '완료: 비밀번호가 변경되었습니다.';
end $$;

create or replace function public.check_admin_pw(p_pw text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from admin_secret where id = 1 and pw_hash = crypt(coalesce(p_pw,''), pw_hash));
$$;

-- 5) 사무소 저장/삭제 함수 (비밀번호 검증 후에만 동작) ---------------
create or replace function public.save_office(p_pw text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare newid bigint; oid bigint;
begin
  if not check_admin_pw(p_pw) then
    return jsonb_build_object('ok', false, 'msg', '비밀번호가 올바르지 않습니다.');
  end if;
  if coalesce(trim(p_data->>'name'),'') = '' then
    return jsonb_build_object('ok', false, 'msg', '상호(사무소명)는 필수입니다.');
  end if;

  oid := nullif(p_data->>'id','')::bigint;

  -- 대표로 지정하면 기존 대표는 해제
  if coalesce((p_data->>'is_primary')::boolean, false) then
    update offices set is_primary = false
     where is_primary and (oid is null or id <> oid);
  end if;

  if oid is null then
    insert into offices (name, ceo, biz_no, reg_no, addr, tel, email, hours, intro, kakao_url, is_primary)
    values (p_data->>'name', p_data->>'ceo', p_data->>'biz_no', p_data->>'reg_no',
            p_data->>'addr', p_data->>'tel', p_data->>'email', p_data->>'hours',
            p_data->>'intro', p_data->>'kakao_url',
            coalesce((p_data->>'is_primary')::boolean, false))
    returning id into newid;
    insert into audit_log(actor, action, target, target_id, detail)
      values ('관리자', 'office.create', p_data->>'name', newid::text, p_data);
  else
    update offices set
      name = p_data->>'name', ceo = p_data->>'ceo', biz_no = p_data->>'biz_no',
      reg_no = p_data->>'reg_no', addr = p_data->>'addr', tel = p_data->>'tel',
      email = p_data->>'email', hours = p_data->>'hours', intro = p_data->>'intro',
      kakao_url = p_data->>'kakao_url',
      is_primary = coalesce((p_data->>'is_primary')::boolean, false),
      updated_at = now()
    where id = oid
    returning id into newid;
    if newid is null then
      return jsonb_build_object('ok', false, 'msg', '해당 사무소를 찾을 수 없습니다.');
    end if;
    insert into audit_log(actor, action, target, target_id, detail)
      values ('관리자', 'office.update', p_data->>'name', newid::text, p_data);
  end if;

  return jsonb_build_object('ok', true, 'id', newid, 'msg', '저장되었습니다.');
end $$;

create or replace function public.delete_office(p_pw text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare gone text;
begin
  if not check_admin_pw(p_pw) then
    return jsonb_build_object('ok', false, 'msg', '비밀번호가 올바르지 않습니다.');
  end if;
  select name into gone from offices where id = p_id;
  delete from offices where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'msg', '해당 사무소를 찾을 수 없습니다.');
  end if;
  insert into audit_log(actor, action, target, target_id)
    values ('관리자', 'office.delete', gone, p_id::text);
  return jsonb_build_object('ok', true, 'msg', '삭제되었습니다.');
end $$;

-- 5.5) 로그 조회 (비밀번호 검증 후에만) -------------------------------
create or replace function public.read_audit_log(p_pw text, p_limit int default 50)
returns setof public.audit_log language plpgsql security definer set search_path = public as $$
begin
  if not check_admin_pw(p_pw) then return; end if;
  return query select * from audit_log order by at desc limit least(coalesce(p_limit,50), 300);
end $$;

-- 6) 호출 권한 ------------------------------------------------------
revoke all on function public.set_admin_pw(text,text)  from public;
revoke all on function public.check_admin_pw(text)     from public;
revoke all on function public.save_office(text,jsonb)  from public;
revoke all on function public.delete_office(text,bigint) from public;
grant execute on function public.set_admin_pw(text,text)    to anon, authenticated;
grant execute on function public.check_admin_pw(text)       to anon, authenticated;
grant execute on function public.save_office(text,jsonb)    to anon, authenticated;
grant execute on function public.delete_office(text,bigint) to anon, authenticated;
revoke all on function public.read_audit_log(text,int) from public;
grant execute on function public.read_audit_log(text,int) to anon, authenticated;

select '완료 — 이제 /admin-vkz/hub 의 [사무소 관리] 탭에서 비밀번호를 먼저 설정하세요.' as 결과;
