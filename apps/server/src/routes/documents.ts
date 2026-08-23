import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { documentDir } from "../config.js";
import {
  createDocumentFromPath,
  createDocumentFromUpload,
  deleteDocument,
  enqueueParse,
  getDocument,
  getDocumentOrThrow,
  getParseProgress,
  isLargeDocument,
  listBlocks,
  listDocuments,
  maybeAutoParseLargeDocument,
  readMarkdown,
} from "../services/documents.js";

export async function registerDocumentRoutes(app: FastifyInstance) {
  app.get("/api/documents", async () => ({ documents: listDocuments() }));

  app.post("/api/documents/ingest", async (request, reply) => {
    const body = (request.body as { path?: string } | undefined) ?? {};
    if (!body.path) return reply.code(400).send({ error: "path_required" });
    const document = await createDocumentFromPath(body.path);
    return { document };
  });

  app.get("/api/documents/:id/parse-progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    return getParseProgress(id);
  });

  app.post("/api/documents", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "pdf_required" });
    }
    const tmp = path.join(os.tmpdir(), `cyc-upload-${randomUUID()}.pdf`);
    try {
      await pipeline(file.file, fs.createWriteStream(tmp));
      const uploaded = await createDocumentFromUpload(file.filename || "document.pdf", tmp);
      const document = maybeAutoParseLargeDocument(uploaded);
      return {
        document,
        auto_parse: document.parse_status === "parsing",
        chunked: isLargeDocument(document),
      };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  app.get("/api/documents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const document = getDocument(id);
    if (!document) return reply.code(404).send({ error: "document_not_found" });
    return { document, blocks: listBlocks(id) };
  });

  app.delete("/api/documents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    deleteDocument(id);
    return { ok: true };
  });

  app.post("/api/documents/:id/parse", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    const body = (request.body as { start_page?: number; end_page?: number; full?: boolean } | undefined) ?? {};
    const document = enqueueParse(id, {
      startPage: body.start_page,
      endPage: body.end_page,
      full: body.full ?? true,
    });
    return {
      accepted: true,
      document,
      blocks: listBlocks(id),
      chunked: isLargeDocument(document) || document.parse_status === "parsing",
    };
  });

  app.get("/api/documents/:id/pdf", async (request, reply) => {
    const { id } = request.params as { id: string };
    const document = getDocumentOrThrow(id);
    const stat = fs.statSync(document.file_path);
    const rawRange = request.headers.range;
    const rangeHeader = Array.isArray(rawRange) ? rawRange[0] : rawRange;
    reply.header("Content-Type", "application/pdf");
    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", "private, max-age=3600");
    reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(document.filename)}"`);
    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        reply.header("Content-Range", `bytes */${stat.size}`);
        return reply.code(416).send();
      }
      const last = Math.min(end, stat.size - 1);
      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${last}/${stat.size}`);
      reply.header("Content-Length", last - start + 1);
      return reply.send(fs.createReadStream(document.file_path, { start, end: last }));
    }
    reply.header("Content-Length", stat.size);
    return reply.send(fs.createReadStream(document.file_path));
  });

  app.get("/api/documents/:id/markdown", async (request) => {
    const { id } = request.params as { id: string };
    getDocumentOrThrow(id);
    return { markdown: readMarkdown(id) };
  });

  app.get("/api/documents/:id/blocks", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { page?: string };
    getDocumentOrThrow(id);
    return { blocks: listBlocks(id, query.page ? Number(query.page) : undefined) };
  });

  app.get("/api/documents/:id/assets/*", async (request, reply) => {
    const { id } = request.params as { id: string };
    getDocumentOrThrow(id);
    const wildcard = (request.params as { "*": string })["*"];
    const target = path.resolve(documentDir(id), wildcard);
    const root = path.resolve(documentDir(id));
    if (!target.startsWith(root) || !fs.existsSync(target)) {
      return reply.code(404).send({ error: "asset_not_found" });
    }
    return reply.send(fs.createReadStream(target));
  });
}
