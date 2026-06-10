-- ① brokers 테이블에 specialist_apts 컬럼 추가
ALTER TABLE brokers ADD COLUMN IF NOT EXISTS specialist_apts JSONB DEFAULT '[]';

-- ② businesses 테이블 생성
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

-- ③ banners 테이블 생성
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
