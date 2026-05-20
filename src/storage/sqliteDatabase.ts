import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type SQLiteValue = string | number | bigint | null | Buffer;
type SQLiteParams = SQLiteValue[] | Record<string, SQLiteValue>;

export type ScoreDatabase = {
  all<T extends Record<string, unknown>>(sql: string, params?: SQLiteParams): T[];
  get<T extends Record<string, unknown>>(sql: string, params?: SQLiteParams): T | undefined;
  run(sql: string, params?: SQLiteParams): void;
  transaction<T>(operation: () => T): T;
  close(): void;
};

function allRows(
  statement: StatementSync,
  params: SQLiteParams | undefined,
): Record<string, unknown>[] {
  if (Array.isArray(params)) {
    return statement.all(...params);
  }
  if (params) {
    return statement.all(params);
  }
  return statement.all();
}

function getRow(
  statement: StatementSync,
  params: SQLiteParams | undefined,
): Record<string, unknown> | undefined {
  if (Array.isArray(params)) {
    return statement.get(...params);
  }
  if (params) {
    return statement.get(params);
  }
  return statement.get();
}

function runStatement(statement: StatementSync, params: SQLiteParams | undefined): void {
  if (Array.isArray(params)) {
    statement.run(...params);
    return;
  }
  if (params) {
    statement.run(params);
    return;
  }
  statement.run();
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS remote_task (
      task_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      case_dir TEXT,
      token TEXT,
      test_case_id INTEGER,
      test_case_name TEXT,
      test_case_type TEXT,
      error TEXT,
      remote_task_file TEXT,
      recovery_attempt_count INTEGER,
      last_recovery_at_ms INTEGER,
      case_name TEXT,
      task_type TEXT,
      score REAL,
      hard_gate_triggered INTEGER,
      result_available INTEGER NOT NULL DEFAULT 0,
      result_error TEXT,
      risks_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_remote_task_status ON remote_task(status);
    CREATE INDEX IF NOT EXISTS idx_remote_task_created_at ON remote_task(created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_remote_task_updated_at ON remote_task(updated_at_ms);
    CREATE INDEX IF NOT EXISTS idx_remote_task_test_case_id ON remote_task(test_case_id);
    CREATE INDEX IF NOT EXISTS idx_remote_task_score ON remote_task(score);

    CREATE TABLE IF NOT EXISTS rule_violation_run (
      task_id INTEGER PRIMARY KEY,
      case_id TEXT NOT NULL,
      test_case_id INTEGER NOT NULL,
      case_name TEXT NOT NULL,
      completed_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rule_violation_run_case_id ON rule_violation_run(case_id);
    CREATE INDEX IF NOT EXISTS idx_rule_violation_run_test_case_id ON rule_violation_run(test_case_id);
    CREATE INDEX IF NOT EXISTS idx_rule_violation_run_completed_at ON rule_violation_run(completed_at_ms);

    CREATE TABLE IF NOT EXISTS rule_violation_item (
      task_id INTEGER NOT NULL,
      item_index INTEGER NOT NULL DEFAULT 0,
      pack_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      rule_summary TEXT NOT NULL,
      rule_source TEXT NOT NULL,
      pack_display_name TEXT,
      conclusion TEXT NOT NULL,
      PRIMARY KEY (task_id, item_index),
      FOREIGN KEY (task_id) REFERENCES rule_violation_run(task_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rule_violation_item_pack_rule
      ON rule_violation_item(pack_id, rule_id);
    CREATE INDEX IF NOT EXISTS idx_rule_violation_item_task_id
      ON rule_violation_item(task_id);
    CREATE INDEX IF NOT EXISTS idx_rule_violation_item_pack_id
      ON rule_violation_item(pack_id);

    CREATE TABLE IF NOT EXISTS consistency_task (
      id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_consistency_task_sequence ON consistency_task(sequence);

    CREATE TABLE IF NOT EXISTS analysis_event (
      dataset_type TEXT NOT NULL,
      event_key TEXT NOT NULL,
      task_id INTEGER,
      test_case_id INTEGER,
      risk_id INTEGER,
      case_name TEXT,
      manual_analysis_status TEXT,
      manual_analyzed_at_ms INTEGER,
      payload_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (dataset_type, event_key)
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_event_dataset_task
      ON analysis_event(dataset_type, task_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_event_manual_status
      ON analysis_event(dataset_type, manual_analysis_status);

    INSERT OR IGNORE INTO schema_migrations (version, applied_at_ms)
    VALUES (1, unixepoch('subsec') * 1000);
  `);
}

export function createScoreDatabase(dbPath: string): ScoreDatabase {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  initializeSchema(db);

  return {
    all<T extends Record<string, unknown>>(sql: string, params?: SQLiteParams): T[] {
      return allRows(db.prepare(sql), params) as T[];
    },

    get<T extends Record<string, unknown>>(sql: string, params?: SQLiteParams): T | undefined {
      return getRow(db.prepare(sql), params) as T | undefined;
    },

    run(sql: string, params?: SQLiteParams): void {
      runStatement(db.prepare(sql), params);
    },

    transaction<T>(operation: () => T): T {
      db.exec("BEGIN");
      try {
        const result = operation();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    close(): void {
      db.close();
    },
  };
}
