import crypto from "node:crypto";
import { db, nowIso, parseJson } from "../db/index.js";
import type { ReviewStatus } from "./reactions.js";

export interface TableRecord {
  id: string;
  document_id: string;
  table_id: string;
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  validation: Record<string, unknown>;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_TABLE_EXAMPLE = {
  table_id: "",
  table_path: "",
  table_title: "",
  table_description: "",
  source_image_path: "",
};

function mapTable(row: Record<string, unknown>): TableRecord {
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    table_id: String(row.table_id),
    payload: parseJson(row.payload_json as string, {}),
    provenance: parseJson(row.provenance_json as string, {}),
    validation: parseJson(row.validation_json as string, {}),
    review_status: row.review_status as ReviewStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

const PAGE_FILTER = `CAST(COALESCE(json_extract(provenance_json, '$.page_no'), json_extract(provenance_json, '$.page')) AS INTEGER)`;

export function listTables(documentId: string, pageNo?: number): TableRecord[] {
  const rows = pageNo
    ? (db
        .prepare(`SELECT * FROM table_records WHERE document_id = ? AND ${PAGE_FILTER} = ? ORDER BY created_at ASC`)
        .all(documentId, pageNo) as Record<string, unknown>[])
    : (db
        .prepare("SELECT * FROM table_records WHERE document_id = ? ORDER BY created_at ASC")
        .all(documentId) as Record<string, unknown>[]);
  return rows.map(mapTable);
}

export function countTables(documentId: string, pageNo?: number): number {
  const row = pageNo
    ? (db.prepare(`SELECT COUNT(*) AS n FROM table_records WHERE document_id = ? AND ${PAGE_FILTER} = ?`).get(documentId, pageNo) as { n: number })
    : (db.prepare("SELECT COUNT(*) AS n FROM table_records WHERE document_id = ?").get(documentId) as { n: number });
  return Number(row.n);
}

export function saveTable(input: {
  documentId: string;
  tableId: string;
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  validation: Record<string, unknown>;
  reviewStatus?: ReviewStatus;
}): TableRecord {
  const existing = db
    .prepare("SELECT id FROM table_records WHERE document_id = ? AND table_id = ?")
    .get(input.documentId, input.tableId) as { id: string } | undefined;
  const timestamp = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE table_records
       SET payload_json = ?, provenance_json = ?, validation_json = ?, review_status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify(input.payload),
      JSON.stringify(input.provenance),
      JSON.stringify(input.validation),
      input.reviewStatus ?? "pending",
      timestamp,
      existing.id,
    );
    return mapTable(db.prepare("SELECT * FROM table_records WHERE id = ?").get(existing.id) as Record<string, unknown>);
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO table_records
     (id, document_id, table_id, payload_json, provenance_json, validation_json, review_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.documentId,
    input.tableId,
    JSON.stringify(input.payload),
    JSON.stringify(input.provenance),
    JSON.stringify(input.validation),
    input.reviewStatus ?? "pending",
    timestamp,
    timestamp,
  );
  return mapTable(db.prepare("SELECT * FROM table_records WHERE id = ?").get(id) as Record<string, unknown>);
}

export function toReviewEnvelope(record: TableRecord): Record<string, unknown> {
  return {
    ...record.payload,
    source_document_id: record.document_id,
    page_no: record.provenance.page_no ?? null,
    bbox: record.provenance.bbox ?? null,
    schema_version: "table.v1",
    review_status: record.review_status,
    quality: record.validation,
    provenance: record.provenance,
  };
}
