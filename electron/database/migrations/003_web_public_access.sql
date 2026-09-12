ALTER TABLE t_frpcd_web_projects
  ADD COLUMN domain_prefix TEXT;

ALTER TABLE t_frpcd_web_projects
  ADD COLUMN fqdn TEXT;

ALTER TABLE t_frpcd_web_projects
  ADD COLUMN remote_port INTEGER
    CHECK (remote_port IS NULL OR remote_port BETWEEN 20000 AND 29999);

ALTER TABLE t_frpcd_web_projects
  ADD COLUMN proxy_id TEXT;

ALTER TABLE t_frpcd_web_projects
  ADD COLUMN public_access_status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (
      public_access_status IN (
        'disabled',
        'deploying',
        'waiting_dns',
        'online',
        'error',
        'cleanup_pending'
      )
    );

ALTER TABLE t_frpcd_web_projects
  ADD COLUMN last_public_access_error TEXT;

ALTER TABLE t_frpcd_web_projects
  ADD COLUMN published_at TEXT;

CREATE UNIQUE INDEX uq_t_frpcd_web_projects_fqdn
  ON t_frpcd_web_projects (fqdn)
  WHERE fqdn IS NOT NULL;

CREATE UNIQUE INDEX uq_t_frpcd_web_projects_remote_port
  ON t_frpcd_web_projects (remote_port)
  WHERE remote_port IS NOT NULL;
