import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { documentDir } from "../config.js";
import { getDocument } from "../services/documents.js";
import { listReactions } from "../services/reactions.js";
import { parseExampleToSchema, projectToSchema } from "../agent/schema-parser.js";
import { DEFAULT_REACTION_EXAMPLE } from "../services/reactions.js";
import { listTables, toReviewEnvelope } from "../services/tables.js";
import { writeReviewJson } from "../services/review.js";

function exportable(includePending: boolean) {
  return (status: string) => (includePending ? status !== "rejected" : status === "approved" || status === "edited");
}

export async function registerExportRoutes(app: FastifyInstance) {
  app.get("/api/documents/:id/export/reactions.json", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    const includePending = String((request.query as { include_pending?: string }).include_pending ?? "") === "true";
    const schema = parseExampleToSchema(DEFAULT_REACTION_EXAMPLE);
    const items = listReactions(id)
      .filter((item) => exportable(includePending)(item.review_status))
      .map((item) => projectToSchema(schema, item.payload));
    const dest = path.join(documentDir(id), "exports", "reactions.json");
    fs.writeFileSync(dest, JSON.stringify(items, null, 2));
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=reactions.json");
    return items;
  });

  app.get("/api/documents/:id/export/reactions.jsonl", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    const includePending = String((request.query as { include_pending?: string }).include_pending ?? "") === "true";
    const schema = parseExampleToSchema(DEFAULT_REACTION_EXAMPLE);
    const lines = listReactions(id)
      .filter((item) => exportable(includePending)(item.review_status))
      .map((item) => JSON.stringify(projectToSchema(schema, item.payload)))
      .join("\n");
    const dest = path.join(documentDir(id), "exports", "reactions.jsonl");
    fs.writeFileSync(dest, lines + (lines ? "\n" : ""));
    reply.header("Content-Type", "application/jsonl; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=reactions.jsonl");
    return reply.send(lines + (lines ? "\n" : ""));
  });

  app.get("/api/documents/:id/export/reactions.rxn", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    const includePending = String((request.query as { include_pending?: string }).include_pending ?? "") === "true";
    const reactions = listReactions(id).filter((item) => exportable(includePending)(item.review_status));
    const chunks: string[] = [];
    for (const reaction of reactions) {
      const rel = reaction.payload.rxn_path;
      if (typeof rel !== "string" || !rel) continue;
      const file = path.resolve(documentDir(id), rel);
      if (fs.existsSync(file)) chunks.push(fs.readFileSync(file, "utf8").trim());
    }
    const body = chunks.join("\n\n$$$$\n\n");
    reply.header("Content-Type", "chemical/x-mdl-rxnfile");
    reply.header("Content-Disposition", "attachment; filename=reactions.rxn");
    return reply.send(body);
  });

  app.get("/api/documents/:id/export/tables.json", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    const includePending = String((request.query as { include_pending?: string }).include_pending ?? "") === "true";
    const items = listTables(id)
      .filter((item) => exportable(includePending)(item.review_status))
      .map((item) => ({
        table_id: item.payload.table_id,
        table_path: item.payload.table_path,
        table_title: item.payload.table_title,
        table_description: item.payload.table_description,
        source_image_path: item.payload.source_image_path,
      }));
    const dest = path.join(documentDir(id), "exports", "tables.json");
    fs.writeFileSync(dest, JSON.stringify(items, null, 2));
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=tables.json");
    return items;
  });

  app.get("/api/documents/:id/export/review.json", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    const files = writeReviewJson(id);
    return {
      files,
      tables: listTables(id).map(toReviewEnvelope),
    };
  });
}
