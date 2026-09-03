-- 2번 파일: 위(build_area_break.sql)를 먼저 실행한 다음, 이 파일을 따로 실행하세요.
-- 딱 한 줄입니다. 다른 SQL과 같이 실행하면 안 먹힐 때가 있어서 파일을 나눠뒀습니다.
-- (표를 만들면 자동으로 잠금이 걸리는데, 그 잠금을 푸는 명령입니다)

alter table apt_area_break disable row level security;
