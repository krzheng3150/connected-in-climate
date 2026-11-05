-- Applied on every server start, so keep statements idempotent.

CREATE EXTENSION IF NOT EXISTS vector;

-- Stable columns for querying; dynamic profile fields live in the JSONB payload.
CREATE TABLE IF NOT EXISTS user_profiles (
  email       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('mentor', 'mentee', 'both')),
  payload     JSONB NOT NULL DEFAULT '{}',
  embedding   vector(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_runs (
  run_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentee_email    TEXT NOT NULL REFERENCES user_profiles(email),
  status          TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                  CHECK (status IN ('PENDING_REVIEW', 'AWAITING_MENTEE', 'ACTIVE', 'CANCELLED')),
  top_candidates  INTEGER NOT NULL,
  total_scored    INTEGER NOT NULL,
  code_commit     TEXT NOT NULL,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_runs_mentee ON match_runs(mentee_email, status);

CREATE TABLE IF NOT EXISTS matches (
  match_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL REFERENCES match_runs(run_id),
  mentor_email          TEXT NOT NULL REFERENCES user_profiles(email),
  mentee_email          TEXT NOT NULL REFERENCES user_profiles(email),
  status                TEXT NOT NULL DEFAULT 'CANDIDATE'
                        CHECK (status IN ('CANDIDATE', 'APPROVED', 'REJECTED', 'ACTIVE', 'STORED', 'FINISHED')),
  final_score           NUMERIC(5,4) NOT NULL,
  rank                  INTEGER NOT NULL,
  computation_payload   JSONB NOT NULL,
  code_commit           TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS resources_folder_url TEXT;

CREATE INDEX IF NOT EXISTS idx_matches_mentee ON matches(mentee_email, status);
CREATE INDEX IF NOT EXISTS idx_matches_mentor ON matches(mentor_email, status);
CREATE INDEX IF NOT EXISTS idx_matches_run ON matches(run_id, status);

CREATE TABLE IF NOT EXISTS match_actions (
  action_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID NOT NULL REFERENCES matches(match_id),
  actor_email  TEXT NOT NULL,
  action_type  TEXT NOT NULL CHECK (action_type IN ('VIEW', 'FEEDBACK', 'CONTACT_CLICK', 'REJECT', 'APPROVE', 'SELECT')),
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_actions_match ON match_actions(match_id);

CREATE TABLE IF NOT EXISTS feedbacks (
  feedback_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         UUID NOT NULL REFERENCES matches(match_id),
  submitter_email  TEXT NOT NULL,
  rating           SMALLINT,
  text             TEXT NOT NULL,
  payload          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_match ON feedbacks(match_id);

CREATE TABLE IF NOT EXISTS rejections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_email    TEXT NOT NULL,
  mentee_email    TEXT NOT NULL,
  match_id        UUID REFERENCES matches(match_id),
  reason          TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rejections_pair ON rejections(mentor_email, mentee_email);
