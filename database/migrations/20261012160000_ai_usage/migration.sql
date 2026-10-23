CREATE TABLE ai_daily_usage (
 user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,day), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE ai_calls (
 id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
 operation TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'STARTED', model TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER, output_tokens INTEGER,
 estimated_cost REAL, currency TEXT NOT NULL, error_code TEXT,
 started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME, duration_ms INTEGER,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX ai_calls_user_id_started_at_idx ON ai_calls(user_id,started_at);
