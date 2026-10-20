CREATE TABLE IF NOT EXISTS zona_players (
  telegram_id BIGINT PRIMARY KEY,
  telegram_username TEXT,
  telegram_name TEXT NOT NULL DEFAULT 'Сталкер',
  game_name TEXT NOT NULL DEFAULT 'Сталкер',
  game_title TEXT NOT NULL DEFAULT 'Новичок',
  level INT NOT NULL DEFAULT 1,
  kills BIGINT NOT NULL DEFAULT 0,
  searches BIGINT NOT NULL DEFAULT 0,
  rubles BIGINT NOT NULL DEFAULT 0,
  gram NUMERIC(18,2) NOT NULL DEFAULT 0,
  score BIGINT NOT NULL DEFAULT 0,
  equipment JSONB NOT NULL DEFAULT '{}'::jsonb,
  game_state JSONB,
  revision BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zona_players_score_idx ON zona_players (score DESC,telegram_id);
CREATE INDEX IF NOT EXISTS zona_players_level_idx ON zona_players (level DESC,score DESC);
CREATE INDEX IF NOT EXISTS zona_players_kills_idx ON zona_players (kills DESC,score DESC);
CREATE INDEX IF NOT EXISTS zona_players_gram_idx ON zona_players (gram DESC,score DESC);
