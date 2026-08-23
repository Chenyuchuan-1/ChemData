import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { config } from "../config.js";

function resolveSqlitePath(databaseUrl: string): string {
  if (databaseUrl.startsWith("sqlite:///")) {
    const raw = databaseUrl.replace("sqlite:///", "");
    return path.isAbsolute(raw) ? raw : path.resolve(config.rootDir, raw);
  }
  if (databaseUrl.startsWith("sqlite://")) {
    const raw = databaseUrl.replace("sqlite://", "");
    return path.isAbsolute(raw) ? raw : path.resolve(config.rootDir, raw);
  }
  throw new Error(
    `This development server currently uses SQLite. Set DATABASE_URL=sqlite:///./data/app.db (got ${databaseUrl}). Postgres can be enabled later without changing the schema.`,
  );
}

const dbPath = resolveSqlitePath(config.databaseUrl);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 8000");
db.pragma("foreign_keys = ON");

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");
db.exec(fs.readFileSync(schemaPath, "utf8"));

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
