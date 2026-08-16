CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember_device BOOLEAN NOT NULL DEFAULT FALSE,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BYTEA NOT NULL,
  webauthn_user_id TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  transports TEXT[],
  label TEXT NOT NULL DEFAULT 'Face ID / Passkey',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  kind TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_challenge_user_kind ON webauthn_challenges(user_id, kind);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system',
  max_rpm INTEGER NOT NULL DEFAULT 4000,
  auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
  units TEXT NOT NULL DEFAULT 'metric',
  machine_name TEXT NOT NULL DEFAULT 'CK52PT-Y · SINUMERIK 828D',
  machine_power_kw NUMERIC NOT NULL DEFAULT 11,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manufacturer TEXT,
  code TEXT,
  grade TEXT,
  tool_type TEXT NOT NULL DEFAULT 'insert',
  nose_radius NUMERIC,
  width_mm NUMERIC,
  diameter_mm NUMERIC,
  handedness TEXT,
  shank_size TEXT,
  compatible_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  operations JSONB NOT NULL DEFAULT '[]'::jsonb,
  iso_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  vc_min NUMERIC,
  vc_max NUMERIC,
  feed_min NUMERIC,
  feed_max NUMERIC,
  ap_min NUMERIC,
  ap_max NUMERIC,
  notes TEXT,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tools_user ON tools(user_id);
ALTER TABLE tools ADD COLUMN IF NOT EXISTS handedness TEXT;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS shank_size TEXT;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS compatible_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS calculations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  material_code TEXT NOT NULL,
  operation TEXT NOT NULL,
  tool_id TEXT REFERENCES tools(id) ON DELETE SET NULL,
  mode TEXT NOT NULL,
  diameter_mm NUMERIC NOT NULL,
  inputs JSONB NOT NULL,
  results JSONB NOT NULL,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calculations_user_created ON calculations(user_id, created_at DESC);

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS machine_power_kw NUMERIC NOT NULL DEFAULT 11;

CREATE TABLE IF NOT EXISTS user_sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
