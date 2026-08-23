import fs from "node:fs";
import path from "node:path";
import { config, documentDir } from "../config.js";
import { listReactions } from "./reactions.js";
import { listTables, toReviewEnvelope } from "./tables.js";
import { getDocumentOrThrow } from "./documents.js";

function safeName(filename: string): string {
  return filename.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").replace(/\.pdf$/i, "");
}

export function writeReviewJson(documentId: string): { reactions: string; tables: string } {
  const document = getDocumentOrThrow(documentId);
  const reviewRoot = path.join(config.storageRoot, "review");
  fs.mkdirSync(reviewRoot, { recursive: true });
  fs.mkdirSync(path.join(documentDir(documentId), "exports"), { recursive: true });

  const reactions = listReactions(documentId).map((item) => ({
    ...item.payload,
    source_document_id: documentId,
    page_no: item.provenance.page_no ?? null,
    bbox: item.provenance.bbox ?? null,
    schema_version: "reaction.v1",
    review_status: item.review_status,
    quality: item.validation,
    provenance: item.provenance,
  }));
  const tables = listTables(documentId).map(toReviewEnvelope);

  const stem = safeName(document.filename);
  const files = {
    reactions: path.join(reviewRoot, `${stem}.reactions.json`),
    tables: path.join(reviewRoot, `${stem}.tables.json`),
  };
  fs.writeFileSync(files.reactions, JSON.stringify(reactions, null, 2));
  fs.writeFileSync(files.tables, JSON.stringify(tables, null, 2));
  fs.writeFileSync(path.join(documentDir(documentId), "exports", "review_reactions.json"), JSON.stringify(reactions, null, 2));
  fs.writeFileSync(path.join(documentDir(documentId), "exports", "review_tables.json"), JSON.stringify(tables, null, 2));
  return files;
}
