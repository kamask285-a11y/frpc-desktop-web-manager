CREATE TABLE IF NOT EXISTS t_frpcd_web_projects (
  id TEXT CONSTRAINT pk_t_frpcd_web_projects PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  start_script TEXT NOT NULL DEFAULT 'start',
  port INTEGER NOT NULL DEFAULT 3000
    CHECK (port BETWEEN 1 AND 65535),
  auto_start INTEGER NOT NULL DEFAULT 0
    CHECK (auto_start IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_t_frpcd_web_projects_path
  ON t_frpcd_web_projects (path);
