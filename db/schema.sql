-- Applied on every server start, so keep statements idempotent.
CREATE TABLE IF NOT EXISTS greetings (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
