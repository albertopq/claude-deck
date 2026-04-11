import type { Pool } from "pg";

export async function createSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tmux_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'idle',
      working_directory TEXT NOT NULL DEFAULT '~',
      parent_session_id TEXT REFERENCES sessions(id),
      claude_session_id TEXT,
      model TEXT DEFAULT 'sonnet',
      system_prompt TEXT,
      group_path TEXT NOT NULL DEFAULT 'sessions',
      project_id TEXT,
      agent_type TEXT NOT NULL DEFAULT 'claude',
      auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
      worktree_path TEXT,
      branch_name TEXT,
      base_branch TEXT,
      dev_server_port INTEGER,
      pr_url TEXT,
      pr_number INTEGER,
      pr_status TEXT,
      conductor_session_id TEXT REFERENCES sessions(id),
      worker_task TEXT,
      worker_status TEXT
    );

    CREATE TABLE IF NOT EXISTS groups (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      expanded BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO groups (path, name, sort_order)
    VALUES ('sessions', 'Sessions', 0)
    ON CONFLICT (path) DO NOTHING;

    CREATE TABLE IF NOT EXISTS dev_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      type TEXT NOT NULL DEFAULT 'node',
      name TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      container_id TEXT,
      ports TEXT NOT NULL DEFAULT '[]',
      working_directory TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      agent_type TEXT NOT NULL DEFAULT 'claude',
      default_model TEXT NOT NULL DEFAULT 'sonnet',
      initial_prompt TEXT,
      expanded BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_uncategorized BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_dev_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'node',
      command TEXT NOT NULL,
      port INTEGER,
      port_env_var TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_repositories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_conductor ON sessions(conductor_session_id);
    CREATE INDEX IF NOT EXISTS idx_project_dev_servers_project ON project_dev_servers(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_repositories_project ON project_repositories(project_id);
    CREATE INDEX IF NOT EXISTS idx_dev_servers_project ON dev_servers(project_id);

    CREATE TABLE IF NOT EXISTS hidden_items (
      id SERIAL PRIMARY KEY,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(item_type, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_hidden_items_type ON hidden_items(item_type);

    INSERT INTO projects (id, name, working_directory, is_uncategorized, sort_order)
    VALUES ('uncategorized', 'Uncategorized', '~', TRUE, 999999)
    ON CONFLICT (id) DO NOTHING;

    ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_project_id_fkey;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'sessions_project_id_fkey'
      ) THEN
        ALTER TABLE sessions ADD CONSTRAINT sessions_project_id_fkey
          FOREIGN KEY (project_id) REFERENCES projects(id);
      END IF;
    END $$;

    ALTER TABLE dev_servers DROP CONSTRAINT IF EXISTS dev_servers_project_id_fkey;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'dev_servers_project_id_fkey'
      ) THEN
        ALTER TABLE dev_servers ADD CONSTRAINT dev_servers_project_id_fkey
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
}
