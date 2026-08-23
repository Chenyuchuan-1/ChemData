import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { db, nowIso } from "../db/index.js";

export interface AgentEvent {
  type: string;
  run_id: string;
  stage?: string;
  message?: string;
  progress?: number;
  [key: string]: unknown;
}

class RunHub {
  private emitters = new Map<string, EventEmitter>();

  get(runId: string): EventEmitter {
    let emitter = this.emitters.get(runId);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(50);
      this.emitters.set(runId, emitter);
    }
    return emitter;
  }

  emit(event: AgentEvent): void {
    db.prepare("INSERT INTO agent_events (run_id, event_json, created_at) VALUES (?, ?, ?)").run(
      event.run_id,
      JSON.stringify(event),
      nowIso(),
    );
    if (event.progress !== undefined || event.stage) {
      db.prepare("UPDATE agent_runs SET progress = COALESCE(?, progress), stage = COALESCE(?, stage), updated_at = ? WHERE id = ?").run(
        event.progress ?? null,
        event.stage ?? null,
        nowIso(),
        event.run_id,
      );
    }
    this.get(event.run_id).emit("event", event);
  }

  history(runId: string): AgentEvent[] {
    const rows = db.prepare("SELECT event_json FROM agent_events WHERE run_id = ? ORDER BY id").all(runId) as Array<{ event_json: string }>;
    return rows.map((row) => JSON.parse(row.event_json) as AgentEvent);
  }
}

export const runHub = new RunHub();

export function createRun(documentId: string, schemaJson: unknown, instruction: string): string {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO agent_runs (id, document_id, status, instruction, schema_json, progress, stage, created_at, updated_at)
     VALUES (?, ?, 'running', ?, ?, 0, 'queued', ?, ?)`,
  ).run(id, documentId, instruction, JSON.stringify(schemaJson), timestamp, timestamp);
  return id;
}

export function finishRun(runId: string, status: "completed" | "failed", summary?: unknown, error?: string): void {
  db.prepare(
    `UPDATE agent_runs SET status = ?, summary_json = ?, error = ?, updated_at = ? WHERE id = ?`,
  ).run(status, summary ? JSON.stringify(summary) : null, error ?? null, nowIso(), runId);
}

export function getRun(runId: string) {
  return db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId) as
    | {
        id: string;
        document_id: string;
        status: string;
        instruction: string | null;
        schema_json: string;
        progress: number;
        stage: string | null;
        summary_json: string | null;
        error: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}
