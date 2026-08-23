import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { db, nowIso, parseJson } from "../db/index.js";
import { createDocumentFromPath, getDocument, getDocumentOrThrow, needsFullParse, parseDocument } from "./documents.js";
import { DEFAULT_REACTION_EXAMPLE } from "./reactions.js";
import { writeReviewJson } from "./review.js";
import { getRun } from "../agent/runs.js";
import { runExtraction } from "../agent/workflows/extraction.js";

export interface BatchJob {
  id: string;
  status: string;
  source_dir: string | null;
  progress: number;
  summary: Record<string, unknown> | null;
  error: string | null;
}

function mapJob(row: Record<string, unknown>): BatchJob {
  return {
    id: String(row.id),
    status: String(row.status),
    source_dir: (row.source_dir as string | null) ?? null,
    progress: Number(row.progress ?? 0),
    summary: parseJson(row.summary_json as string | null, null),
    error: (row.error as string | null) ?? null,
  };
}

export function getBatchJob(id: string): BatchJob | undefined {
  const row = db.prepare("SELECT * FROM batch_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapJob(row) : undefined;
}

function updateJob(id: string, fields: { status?: string; progress?: number; summary?: unknown; error?: string | null }) {
  const current = db.prepare("SELECT * FROM batch_jobs WHERE id = ?").get(id) as Record<string, unknown>;
  db.prepare(
    `UPDATE batch_jobs SET status = ?, progress = ?, summary_json = ?, error = ?, updated_at = ? WHERE id = ?`,
  ).run(
    fields.status ?? current.status,
    fields.progress ?? current.progress,
    fields.summary ? JSON.stringify(fields.summary) : current.summary_json,
    fields.error === undefined ? current.error : fields.error,
    nowIso(),
    id,
  );
}

function clearExtractions(documentId: string) {
  db.prepare("DELETE FROM reaction_records WHERE document_id = ?").run(documentId);
  db.prepare("DELETE FROM table_records WHERE document_id = ?").run(documentId);
}

function hasExtractions(documentId: string): boolean {
  const reactions = db.prepare("SELECT COUNT(*) AS n FROM reaction_records WHERE document_id = ?").get(documentId) as {
    n: number;
  };
  const tables = db.prepare("SELECT COUNT(*) AS n FROM table_records WHERE document_id = ?").get(documentId) as {
    n: number;
  };
  return Number(reactions.n) + Number(tables.n) > 0;
}

async function waitForDocumentParse(documentId: string, timeoutMs = 36_000_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const document = getDocument(documentId);
    if (!document) throw new Error(`document_missing:${documentId}`);
    if (document.parse_status === "completed" || document.parse_status === "failed") return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("parse_wait_timeout");
}

async function waitForRun(runId: string, timeoutMs = 21_600_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = getRun(runId);
    if (run?.status === "completed" || run?.status === "failed") return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("extraction_timeout");
}

export function startZcyBatch(sourceDir = path.join(config.rootDir, "zcy")): string {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO batch_jobs (id, status, source_dir, progress, created_at, updated_at)
     VALUES (?, 'running', ?, 0, ?, ?)`,
  ).run(id, sourceDir, timestamp, timestamp);

  void (async () => {
    const files = fs
      .readdirSync(sourceDir)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .map((name) => ({ name, size: fs.statSync(path.join(sourceDir, name)).size }))
      .sort((a, b) => a.size - b.size)
      .map((item) => item.name);
    const results: Array<Record<string, unknown>> = [];
    try {
      for (const [index, name] of files.entries()) {
        const source = path.join(sourceDir, name);
        updateJob(id, {
          progress: index / Math.max(files.length, 1),
          summary: { current: name, done: results, remaining: files.length - index },
        });
        const document = await createDocumentFromPath(source);
        if (document.parse_status === "parsing") {
          await waitForDocumentParse(document.id);
        }
        const latest = getDocumentOrThrow(document.id);
        if (needsFullParse(latest)) {
          await parseDocument(latest.id, { full: true });
          clearExtractions(latest.id);
        }
        const ready = getDocumentOrThrow(document.id);
        if (ready.parse_status !== "completed") {
          throw new Error(`parse_not_completed:${ready.filename}:${ready.parse_error ?? ready.parse_status}`);
        }
        if (hasExtractions(ready.id)) {
          const review = writeReviewJson(ready.id);
          results.push({
            filename: name,
            document_id: ready.id,
            parse_status: ready.parse_status,
            skipped_extract: true,
            review,
          });
          continue;
        }
        const { runId } = await runExtraction({
          documentId: ready.id,
          example: DEFAULT_REACTION_EXAMPLE,
          instruction: "请按照反应 JSON Schema 抽取当前 PDF 中所有报告的化学反应，并同时抽取全部表格。",
        });
        await waitForRun(runId);
        const review = writeReviewJson(ready.id);
        results.push({
          filename: name,
          document_id: ready.id,
          parse_status: getDocumentOrThrow(ready.id).parse_status,
          run_id: runId,
          review,
        });
      }
      updateJob(id, { status: "completed", progress: 1, summary: { files: results }, error: null });
    } catch (error) {
      updateJob(id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        summary: { files: results },
      });
    }
  })();

  return id;
}
