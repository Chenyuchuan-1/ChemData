import type { FastifyInstance } from "fastify";
import { getDocument } from "../services/documents.js";
import {
  getReaction,
  listReactions,
  updateReaction,
  type ReviewStatus,
} from "../services/reactions.js";
import { listTables } from "../services/tables.js";
import { scientific } from "../services/scientific.js";

export async function registerReactionRoutes(app: FastifyInstance) {
  app.get("/api/documents/:id/reactions", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    return { reactions: listReactions(id) };
  });

  app.get("/api/documents/:id/tables", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    return { tables: listTables(id) };
  });

  app.get("/api/reactions/:reactionId", async (request, reply) => {
    const { reactionId } = request.params as { reactionId: string };
    const reaction = getReaction(reactionId);
    if (!reaction) return reply.code(404).send({ error: "reaction_not_found" });
    return { reaction };
  });

  app.patch("/api/reactions/:reactionId", async (request, reply) => {
    const { reactionId } = request.params as { reactionId: string };
    const current = getReaction(reactionId);
    if (!current) return reply.code(404).send({ error: "reaction_not_found" });
    const body = (request.body as {
      payload?: Record<string, unknown>;
      provenance?: Record<string, unknown>;
      review_status?: ReviewStatus;
    }) ?? {};
    const reaction = updateReaction(reactionId, {
      payload: body.payload,
      provenance: body.provenance,
      review_status: body.review_status ?? (body.payload ? "edited" : current.review_status),
    });
    return { reaction };
  });

  app.post("/api/reactions/:reactionId/approve", async (request, reply) => {
    const { reactionId } = request.params as { reactionId: string };
    if (!getReaction(reactionId)) return reply.code(404).send({ error: "reaction_not_found" });
    return { reaction: updateReaction(reactionId, { review_status: "approved" }) };
  });

  app.post("/api/reactions/:reactionId/reject", async (request, reply) => {
    const { reactionId } = request.params as { reactionId: string };
    if (!getReaction(reactionId)) return reply.code(404).send({ error: "reaction_not_found" });
    const body = (request.body as { status?: ReviewStatus } | undefined) ?? {};
    return { reaction: updateReaction(reactionId, { review_status: body.status ?? "rejected" }) };
  });

  app.post("/api/chemistry/validate-smiles", async (request) => {
    const { smiles } = request.body as { smiles: string };
    return scientific.validateSmiles(smiles);
  });

  app.post("/api/chemistry/depict", async (request) => {
    return scientific.depict(request.body as Record<string, unknown>);
  });
}
