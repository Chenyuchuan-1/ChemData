import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config, documentDir } from "../config.js";
import { db, nowIso, parseJson } from "../db/index.js";
import { scientific, type NormalizedBlock } from "./scientific.js";

export interface DocumentRow {
  id: string;
  filename: string;
  file_path: string;
  sha256: string;
  page_count: number;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlockRow {
  id: string;
  document_id: string;
  page_no: number;
  block_type: string;
  text: string | null;
  bbox: number[];
  bbox_norm: number[];
  image_path: string | null;
  reading_order: number;
  meta: Record<string, unknown>;
}

function mapDocument(row: DocumentRow): DocumentRow {
  return row;
}

function mapBlock(row: Record<string, unknown>): BlockRow {
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    page_no: Number(row.page_no),
    block_type: String(row.block_type),
    text: (row.text as string | null) ?? null,
    bbox: parseJson<number[]>(row.bbox_json as string, []),
    bbox_norm: parseJson<number[]>(row.bbox_norm_json as string, []),
    image_path: (row.image_path as string | null) ?? null,
    reading_order: Number(row.reading_order ?? 0),
    meta: parseJson<Record<string, unknown>>(row.meta_json as string, {}),
  };
}

export function listDocuments(): DocumentRow[] {
  return db.prepare("SELECT * FROM documents ORDER BY created_at DESC").all() as DocumentRow[];
}

export function getDocument(id: string): DocumentRow | undefined {
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
}

export function getDocumentOrThrow(id: string): DocumentRow {
  const document = getDocument(id);
  if (!document) throw new Error("document_not_found");
  return document;
}

export function listBlocks(documentId: string, pageNo?: number): BlockRow[] {
  const rows = pageNo
    ? db.prepare("SELECT * FROM parsed_blocks WHERE document_id = ? AND page_no = ? ORDER BY reading_order").all(documentId, pageNo)
    : db.prepare("SELECT * FROM parsed_blocks WHERE document_id = ? ORDER BY page_no, reading_order").all(documentId);
  return (rows as Record<string, unknown>[]).map(mapBlock);
}

export function searchBlocks(documentId: string, query: string, limit = 30): BlockRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM parsed_blocks
       WHERE document_id = ? AND text LIKE ?
       ORDER BY page_no, reading_order
       LIMIT ?`,
    )
    .all(documentId, `%${query}%`, limit);
  return (rows as Record<string, unknown>[]).map(mapBlock);
}

export function pdfFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function isLargePdf(pageCount: number, fileSizeBytes: number): boolean {
  return pageCount > config.mineru.autoChunkPages || fileSizeBytes > config.mineru.autoChunkBytes;
}

export function isLargeDocument(document: DocumentRow): boolean {
  return isLargePdf(document.page_count, pdfFileSize(document.file_path));
}

const runningParses = new Map<string, Promise<DocumentRow>>();

export function isParseRunning(documentId: string): boolean {
  return runningParses.has(documentId);
}

export async function createDocumentFromPath(sourcePath: string, filename?: string): Promise<DocumentRow> {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) throw new Error(`file_not_found:${resolved}`);
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(resolved);
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  const sha256 = hash.digest("hex");
  const existing = db.prepare("SELECT * FROM documents WHERE sha256 = ?").get(sha256) as DocumentRow | undefined;
  if (existing) {
    if (!fs.existsSync(existing.file_path) || fs.statSync(existing.file_path).size === 0) {
      fs.mkdirSync(path.dirname(existing.file_path), { recursive: true });
      fs.copyFileSync(resolved, existing.file_path);
    }
    return existing;
  }

  const id = sha256;
  const dir = documentDir(id);
  for (const name of ["mineru", "pages", "crops", "reactions", "tables", "images", "exports", "chunks"]) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  }
  const filePath = path.join(dir, "original.pdf");
  if (path.resolve(resolved) !== path.resolve(filePath)) {
    fs.copyFileSync(resolved, filePath);
  }
  const info = await scientific.pdfInfo(filePath);
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO documents (id, filename, file_path, sha256, page_count, parse_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
  ).run(id, filename ?? path.basename(resolved), filePath, sha256, info.page_count, timestamp, timestamp);
  return getDocumentOrThrow(id);
}

export async function createDocumentFromUpload(filename: string, sourcePath: string): Promise<DocumentRow> {
  const document = await createDocumentFromPath(sourcePath, path.basename(filename));
  if (!isLargeDocument(document)) {
    try {
      const limit = config.mineru.maxPages > 0 ? Math.min(document.page_count, config.mineru.maxPages) : Math.min(document.page_count, 8);
      await scientific.renderPages({
        pdf_path: document.file_path,
        output_dir: path.join(documentDir(document.id), "pages"),
        dpi: 120,
        start_page: 0,
        end_page: Math.max(limit - 1, 0),
      });
    } catch {
      // Page images are helpful but not required to keep the upload.
    }
  }
  return document;
}

export function parsedPageCoverage(documentId: string): { maxPage: number; blockCount: number } {
  const row = db
    .prepare("SELECT COALESCE(MAX(page_no), 0) AS max_page, COUNT(*) AS n FROM parsed_blocks WHERE document_id = ?")
    .get(documentId) as { max_page: number; n: number };
  return { maxPage: Number(row.max_page), blockCount: Number(row.n) };
}

export function needsFullParse(document: DocumentRow): boolean {
  if (document.parse_status !== "completed") return true;
  const { maxPage, blockCount } = parsedPageCoverage(document.id);
  if (blockCount === 0) return true;
  return maxPage < Math.max(document.page_count - 2, 1);
}

export function updateDocument(id: string, fields: Partial<DocumentRow>): void {
  const current = getDocumentOrThrow(id);
  const next = { ...current, ...fields, updated_at: nowIso() };
  db.prepare(
    `UPDATE documents
     SET filename = ?, file_path = ?, page_count = ?, parse_status = ?, parse_error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(next.filename, next.file_path, next.page_count, next.parse_status, next.parse_error ?? null, next.updated_at, id);
}

export function replaceBlocks(documentId: string, blocks: NormalizedBlock[]): void {
  const deleteStmt = db.prepare("DELETE FROM parsed_blocks WHERE document_id = ?");
  const insert = db.prepare(
    `INSERT INTO parsed_blocks
     (id, document_id, page_no, block_type, text, bbox_json, bbox_norm_json, image_path, reading_order, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    deleteStmt.run(documentId);
    for (const block of blocks) {
      insert.run(
        block.id,
        documentId,
        block.page_no,
        block.block_type,
        block.text,
        JSON.stringify(block.bbox),
        JSON.stringify(block.bbox_norm),
        block.image_path,
        block.reading_order,
        JSON.stringify(block.meta ?? {}),
      );
    }
  });
  tx();
}

export interface ParseChunkProgress {
  chunk_id: string;
  start_page: number;
  end_page: number;
  page_count: number;
  status: string;
  error?: string | null;
}

export interface ParseProgress {
  document: DocumentRow;
  running: boolean;
  large: boolean;
  chunked: boolean;
  file_size_bytes: number;
  chunk_count: number;
  completed_chunks: number;
  failed_chunks: number;
  current_chunk: ParseChunkProgress | null;
  chunks: ParseChunkProgress[];
  message: string | null;
}

function summarizeChunks(chunks: ParseChunkProgress[]): Pick<ParseProgress, "completed_chunks" | "failed_chunks" | "current_chunk"> {
  const completed_chunks = chunks.filter((item) => item.status === "completed").length;
  const failed_chunks = chunks.filter((item) => item.status === "failed").length;
  const current_chunk =
    chunks.find((item) => item.status === "retrying" || item.status === "running" || item.status === "parsing") ??
    chunks.find((item) => item.status === "pending") ??
    null;
  return { completed_chunks, failed_chunks, current_chunk };
}

export async function getParseProgress(documentId: string): Promise<ParseProgress> {
  const document = getDocumentOrThrow(documentId);
  const file_size_bytes = pdfFileSize(document.file_path);
  const large = isLargePdf(document.page_count, file_size_bytes);
  let chunks: ParseChunkProgress[] = [];
  try {
    const manifest = (await scientific.parseManifest(documentDir(documentId))) as {
      chunks?: ParseChunkProgress[];
    };
    chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];
  } catch {
    chunks = [];
  }
  const { completed_chunks, failed_chunks, current_chunk } = summarizeChunks(chunks);
  return {
    document,
    running: runningParses.has(documentId) || document.parse_status === "parsing",
    large,
    chunked: chunks.length > 0 || large || document.parse_status === "parsing",
    file_size_bytes,
    chunk_count: chunks.length,
    completed_chunks,
    failed_chunks,
    current_chunk,
    chunks,
    message: document.parse_error,
  };
}

export function enqueueParse(documentId: string, options?: { startPage?: number; endPage?: number; full?: boolean }): DocumentRow {
  const current = getDocumentOrThrow(documentId);
  if (runningParses.has(documentId)) return current;
  updateDocument(documentId, { parse_status: "parsing", parse_error: "正在规划分块管道..." });
  const job = parseDocument(documentId, options)
    .catch(() => getDocumentOrThrow(documentId))
    .finally(() => {
      runningParses.delete(documentId);
    });
  runningParses.set(documentId, job);
  return getDocumentOrThrow(documentId);
}

export function maybeAutoParseLargeDocument(document: DocumentRow): DocumentRow {
  if (document.parse_status === "completed") return document;
  if (document.parse_status === "parsing" && runningParses.has(document.id)) return document;
  if (!isLargeDocument(document)) return document;
  return enqueueParse(document.id, { full: true });
}

export async function parseDocument(documentId: string, options?: { startPage?: number; endPage?: number; full?: boolean }): Promise<DocumentRow> {
  const document = getDocumentOrThrow(documentId);
  updateDocument(documentId, { parse_status: "parsing", parse_error: "正在规划分块管道..." });

  const dir = documentDir(documentId);
  const startPage = options?.startPage ?? 0;
  let endPage = options?.endPage;
  if (endPage === undefined && !options?.full && config.mineru.maxPages > 0 && document.page_count > config.mineru.maxPages) {
    endPage = startPage + config.mineru.maxPages - 1;
  }

  try {
    const plan = await scientific.planParse({
      document_id: documentId,
      input_pdf: document.file_path,
      output_dir: dir,
      start_page: startPage,
      end_page: endPage,
      chunk_pages: config.mineru.chunkPages,
      overlap: config.mineru.chunkOverlap,
      force_chunked: true,
    });
    const chunks = plan.chunks ?? [];
    for (const [index, chunk] of chunks.entries()) {
      if (chunk.status === "completed") continue;
      updateDocument(documentId, {
        parse_status: "parsing",
        parse_error: `MinerU chunk ${chunk.chunk_id} ${index + 1}/${chunks.length} (p${chunk.start_page + 1}-${chunk.end_page + 1})`,
      });
      try {
        await scientific.parseChunk({
          output_dir: dir,
          chunk_id: chunk.chunk_id,
          backend: config.mineru.backend,
          mode: config.mineru.mode,
        });
      } catch (error) {
        updateDocument(documentId, {
          parse_status: "parsing",
          parse_error: `chunk ${chunk.chunk_id} failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    const parseResult = await scientific.mergeParse({ output_dir: dir, document_id: documentId });
    const normalized = await scientific.normalizeBlocks({
      document_id: documentId,
      output_dir: dir,
    });
    replaceBlocks(documentId, normalized.blocks);
    updateDocument(documentId, {
      parse_status: "completed",
      parse_error: parseResult.warnings?.length ? parseResult.warnings.join(" | ") : null,
    });
    return getDocumentOrThrow(documentId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateDocument(documentId, { parse_status: "failed", parse_error: message });
    throw error;
  }
}

export function deleteDocument(documentId: string): void {
  const document = getDocument(documentId);
  if (!document) return;
  db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
  const dir = documentDir(documentId);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function readMarkdown(documentId: string): string {
  const file = path.join(documentDir(documentId), "mineru", "markdown.md");
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

export function listPageImages(documentId: string): Array<{ page_no: number; path: string }> {
  const dir = path.join(documentDir(documentId), "pages");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".png"))
    .sort()
    .map((name) => ({
      page_no: Number(name.replace(/[^\d]/g, "")),
      path: path.join(dir, name),
    }));
}

export function publicAssetPath(documentId: string, relativePath: string): string {
  const safe = relativePath.replace(/^\/+/, "");
  return `/api/documents/${documentId}/assets/${safe}`;
}
