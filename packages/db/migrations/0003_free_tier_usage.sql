-- Free-tier metering. The shared Jev and chat keys belong to the project
-- owner, so a visitor gets a fixed allowance before they must bring their own.
-- Counted separately: a ranked page and a chat message cost different things.
CREATE TABLE usage_counters (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- 'rank' (Jev identification) or 'chat' (hosted model).
  kind text NOT NULL CHECK (kind IN ('rank', 'chat')),
  used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
