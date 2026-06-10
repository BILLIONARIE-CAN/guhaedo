-- ① businesses 테이블 생성
CREATE TABLE IF NOT EXISTS businesses (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT,
  phone      TEXT,
  addr       TEXT,
  lat        FLOAT8,
  lng        FLOAT8,
  photo      TEXT,
  active     BOOL DEFAULT TRUE,
  expires_at DATE,
  memo       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ② banners 테이블 생성
CREATE TABLE IF NOT EXISTS banners (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name TEXT,
  category      TEXT,
  phone         TEXT,
  image         TEXT,
  areas         JSONB DEFAULT '[]',
  active        BOOL DEFAULT TRUE,
  expires_at    DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ③ broker_apts 테이블 생성 (중개사-단지 가입 관계)
CREATE TABLE IF NOT EXISTS broker_apts (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  broker_id  UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  kapt_code  TEXT NOT NULL,
  apt_name   TEXT,
  start_date DATE,
  expires_at DATE,
  active     BOOL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(broker_id, kapt_code)
);
CREATE INDEX IF NOT EXISTS idx_broker_apts_kapt ON broker_apts(kapt_code);
CREATE INDEX IF NOT EXISTS idx_broker_apts_broker ON broker_apts(broker_id);

-- ④ brokers 테이블에 specialist_apts 컬럼이 이미 추가됐다면 제거 (선택)
-- ALTER TABLE brokers DROP COLUMN IF EXISTS specialist_apts;
