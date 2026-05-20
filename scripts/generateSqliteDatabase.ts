import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "dotenv";
import { getConfig } from "../src/config.js";
import {
  buildSqliteRuleViolationStatsResponse,
  listSqliteRemoteTaskSummaries,
} from "../src/storage/sqliteStores.js";
import { backfillSqliteIndexes } from "../src/storage/sqliteBackfill.js";
import { createScoreDatabase } from "../src/storage/sqliteDatabase.js";

type Options = {
  envFile?: string;
  localCaseRoot?: string;
  dbPath?: string;
  force: boolean;
  help: boolean;
};

function usage(): string {
  return `Usage:
  npm run db:generate -- [options]
  node --import tsx scripts/generateSqliteDatabase.ts [options]

Options:
  --env-file <path>         Load environment variables from a deployment .env file.
  --local-case-root <path>  Override LOCAL_CASE_ROOT.
  --db-path <path>          Override output database path. Defaults to <LOCAL_CASE_ROOT>/score-index.sqlite3.
  --force                   Remove an existing database before generating it.
  --help                    Show this help.

Examples:
  npm run db:generate -- --env-file /opt/hmos-score-agent/.env
  npm run db:generate -- --local-case-root /data/hmos-score-agent/local-cases --force
`;
}

function readArg(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(args: string[]): Options {
  const options: Options = { force: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--env-file":
        options.envFile = readArg(args, index, arg);
        index += 1;
        break;
      case "--local-case-root":
        options.localCaseRoot = readArg(args, index, arg);
        index += 1;
        break;
      case "--db-path":
        options.dbPath = readArg(args, index, arg);
        index += 1;
        break;
      case "--force":
        options.force = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function loadEnvFile(envFile: string): void {
  const resolved = path.resolve(envFile);
  const parsed = parse(fs.readFileSync(resolved, "utf-8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }
}

function removeDatabaseFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([name, count]) => `  ${name}: ${String(count)}`)
    .join("\n");
}

function validateSqliteIntegrity(db: ReturnType<typeof createScoreDatabase>): void {
  const integrity = db.get<{ integrity_check: string }>("PRAGMA integrity_check");
  if (integrity?.integrity_check !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${integrity?.integrity_check ?? "unknown"}`);
  }
  const foreignKeyFailures = db.all<Record<string, unknown>>("PRAGMA foreign_key_check");
  if (foreignKeyFailures.length > 0) {
    throw new Error(
      `SQLite foreign_key_check failed: ${String(foreignKeyFailures.length)} violation(s)`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.envFile) {
    loadEnvFile(options.envFile);
  }
  if (options.localCaseRoot) {
    process.env.LOCAL_CASE_ROOT = path.resolve(options.localCaseRoot);
  }

  const config = getConfig();
  const localCaseRoot = options.localCaseRoot
    ? path.resolve(options.localCaseRoot)
    : config.localCaseRoot;
  const dbPath = options.dbPath
    ? path.resolve(options.dbPath)
    : path.join(localCaseRoot, "score-index.sqlite3");

  if (!fs.existsSync(localCaseRoot)) {
    throw new Error(`LOCAL_CASE_ROOT does not exist: ${localCaseRoot}`);
  }
  if (fs.existsSync(dbPath) && !options.force) {
    throw new Error(`Database already exists: ${dbPath}. Use --force to rebuild it.`);
  }
  if (options.force) {
    removeDatabaseFiles(dbPath);
  }

  const db = createScoreDatabase(dbPath);
  try {
    await backfillSqliteIndexes({ localCaseRoot, db });
    const counts = {
      remote_task:
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM remote_task")?.count ?? 0,
      rule_violation_run:
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM rule_violation_run")?.count ?? 0,
      rule_violation_item:
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM rule_violation_item")?.count ?? 0,
      consistency_task:
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM consistency_task")?.count ?? 0,
    };
    const summaries = listSqliteRemoteTaskSummaries(db);
    const ruleStats = buildSqliteRuleViolationStatsResponse(db, {});
    validateSqliteIntegrity(db);

    if (counts.remote_task === 0) {
      throw new Error("Generated database has no remote_task records.");
    }
    if (summaries.length !== counts.remote_task) {
      throw new Error(
        `Dashboard summary validation failed: summaries=${String(summaries.length)} remote_task=${String(counts.remote_task)}`,
      );
    }
    if (ruleStats.summary.totalRuns !== counts.rule_violation_run) {
      throw new Error(
        `Rule stats validation failed: totalRuns=${String(ruleStats.summary.totalRuns)} rule_violation_run=${String(counts.rule_violation_run)}`,
      );
    }

    console.log("SQLite database is ready.");
    console.log(`database: ${dbPath}`);
    console.log(`local case root: ${localCaseRoot}`);
    console.log("counts:");
    console.log(formatCounts(counts));
    console.log(`dashboard task summaries: ${String(summaries.length)}`);
    console.log(`rule stats total runs: ${String(ruleStats.summary.totalRuns)}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
