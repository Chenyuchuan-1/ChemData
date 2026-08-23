CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  page_count INTEGER NOT NULL DEFAULT 0,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parsed_blocks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_no INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  text TEXT,
  bbox_json TEXT NOT NULL,
  bbox_norm_json TEXT NOT NULL,
  image_path TEXT,
  reading_order INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blocks_document_page
  ON parsed_blocks(document_id, page_no, reading_order);

CREATE TABLE IF NOT EXISTS reaction_records (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reactions_document
  ON reaction_records(document_id, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL,
  instruction TEXT,
  schema_json TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  stage TEXT,
  summary_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_run ON agent_events(run_id, id);

CREATE TABLE IF NOT EXISTS table_records (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tables_document
  ON table_records(document_id, table_id);

CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  source_dir TEXT,
  progress REAL NOT NULL DEFAULT 0,
  summary_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
