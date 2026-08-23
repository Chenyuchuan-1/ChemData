import type { FastifyInstance } from "fastify";
import { getBatchJob, startZcyBatch } from "../services/batch.js";
import { writeReviewJson } from "../services/review.js";
import { getDocument } from "../services/documents.js";

export async function registerBatchRoutes(app: FastifyInstance) {
  app.post("/api/batch/zcy", async (request) => {
    const body = (request.body as { source_dir?: string } | undefined) ?? {};
    const jobId = startZcyBatch(body.source_dir);
    return { job_id: jobId };
  });

  app.get("/api/batch/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getBatchJob(jobId);
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    return { job };
  });

  app.post("/api/documents/:id/review-json", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    return { files: writeReviewJson(id) };
  });
}
