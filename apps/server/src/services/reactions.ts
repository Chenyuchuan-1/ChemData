import crypto from "node:crypto";
import { db, nowIso, parseJson } from "../db/index.js";

export type ReviewStatus = "pending" | "approved" | "edited" | "uncertain" | "rejected";

export interface ReactionRecord {
  id: string;
  document_id: string;
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  validation: Record<string, unknown>;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

function mapReaction(row: Record<string, unknown>): ReactionRecord {
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    payload: parseJson(row.payload_json as string, {}),
    provenance: parseJson(row.provenance_json as string, {}),
    validation: parseJson(row.validation_json as string, {}),
    review_status: row.review_status as ReviewStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function listReactions(documentId: string): ReactionRecord[] {
  const rows = db
    .prepare("SELECT * FROM reaction_records WHERE document_id = ? ORDER BY created_at ASC")
    .all(documentId) as Record<string, unknown>[];
  return rows.map(mapReaction);
}

export function getReaction(id: string): ReactionRecord | undefined {
  const row = db.prepare("SELECT * FROM reaction_records WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapReaction(row) : undefined;
}

export function getReactionOrThrow(id: string): ReactionRecord {
  const reaction = getReaction(id);
  if (!reaction) throw new Error("reaction_not_found");
  return reaction;
}

export function applyReactionBusinessRules(
  payload: Record<string, unknown>,
  provenance: Record<string, unknown> = {},
): { payload: Record<string, unknown>; missing: Array<{ field: string; missing_reason: string }> } {
  const next = { ...payload };
  const missing: Array<{ field: string; missing_reason: string }> = [];
  const source = String(provenance.source_text ?? "");

  const mapped = next.atom_mapped_reaction_smiles;
  const mappedOk = typeof mapped === "string" && mapped.includes(">>") && /:\d+/.test(mapped) && mapped !== "...";
  if (!mappedOk) {
    next.atom_mapped_reaction_smiles = null;
    missing.push({ field: "atom_mapped_reaction_smiles", missing_reason: "extraction_failed" });
  }

  const rawYield = next.yield_percent;
  if (rawYield === "" || rawYield === undefined || rawYield === null) {
    next.yield_percent = null;
    missing.push({ field: "yield_percent", missing_reason: "source_not_present" });
  } else {
    const numeric = Number(rawYield);
    const mentioned =
      Number.isFinite(numeric) &&
      new RegExp(`(^|[^0-9.])${String(numeric).replace(".", "\\.")}\\s*%`).test(source);
    if (!Number.isFinite(numeric)) {
      next.yield_percent = null;
      missing.push({ field: "yield_percent", missing_reason: "extraction_failed" });
    } else if (!mentioned) {
      next.yield_percent = null;
      missing.push({ field: "yield_percent", missing_reason: "source_not_present" });
    } else {
      next.yield_percent = numeric;
    }
  }

  return { payload: next, missing };
}

export function saveReaction(input: {
  documentId: string;
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  validation: Record<string, unknown>;
  reviewStatus?: ReviewStatus;
  id?: string;
}): ReactionRecord {
  const timestamp = nowIso();
  const id = input.id ?? crypto.randomUUID();
  const rules = applyReactionBusinessRules(input.payload, input.provenance);
  const existingMissing = Array.isArray(input.validation.missing)
    ? (input.validation.missing as Array<{ field: string; missing_reason: string }>)
    : [];
  const missing = [...existingMissing];
  for (const item of rules.missing) {
    if (!missing.some((row) => row.field === item.field)) missing.push(item);
  }
  const validation = { ...input.validation, missing };
  db.prepare(
    `INSERT INTO reaction_records
     (id, document_id, payload_json, provenance_json, validation_json, review_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.documentId,
    JSON.stringify(rules.payload),
    JSON.stringify(input.provenance),
    JSON.stringify(validation),
    input.reviewStatus ?? "pending",
    timestamp,
    timestamp,
  );
  return getReactionOrThrow(id);
}

export function updateReaction(
  id: string,
  patch: {
    payload?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
    validation?: Record<string, unknown>;
    review_status?: ReviewStatus;
  },
): ReactionRecord {
  const current = getReactionOrThrow(id);
  const next = {
    payload: patch.payload ?? current.payload,
    provenance: patch.provenance ?? current.provenance,
    validation: patch.validation ?? current.validation,
    review_status: patch.review_status ?? current.review_status,
    updated_at: nowIso(),
  };
  db.prepare(
    `UPDATE reaction_records
     SET payload_json = ?, provenance_json = ?, validation_json = ?, review_status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify(next.payload),
    JSON.stringify(next.provenance),
    JSON.stringify(next.validation),
    next.review_status,
    next.updated_at,
    id,
  );
  return getReactionOrThrow(id);
}

export function reactionFingerprint(payload: Record<string, unknown>, provenance: Record<string, unknown>): string {
  const key = JSON.stringify({
    smiles: payload.reaction_smiles ?? null,
    text: payload.reaction_text ?? null,
    page: provenance.page_no ?? null,
    yield: payload.yield_percent ?? null,
  });
  return crypto.createHash("sha1").update(key).digest("hex");
}

export function findDuplicate(documentId: string, payload: Record<string, unknown>, provenance: Record<string, unknown>): ReactionRecord | undefined {
  const target = reactionFingerprint(payload, provenance);
  return listReactions(documentId).find((item) => reactionFingerprint(item.payload, item.provenance) === target);
}

export const DEFAULT_REACTION_EXAMPLE = {
  reaction_text: "",
  reaction_smiles: "",
  atom_mapped_reaction_smiles: null,
  reaction_latex: "",
  rxn_path: "",
  conditions: {
    catalyst: null,
    temperature_c: null,
    time_h: null,
  },
  yield_percent: null,
};
