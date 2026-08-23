import type { FastifyInstance } from "fastify";
import { DEFAULT_REACTION_EXAMPLE } from "../services/reactions.js";
import { getDocument } from "../services/documents.js";
import { createRun, getRun, runHub } from "../agent/runs.js";
import { runExtraction, seedMockReactions } from "../agent/workflows/extraction.js";

export async function registerAgentRoutes(app: FastifyInstance) {
  app.post("/api/documents/:id/agent/extract", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDocument(id)) return reply.code(404).send({ error: "document_not_found" });
    const body = (request.body as {
      example?: unknown;
      instruction?: string;
      mock?: boolean;
    }) ?? {};
    if (body.mock) {
      const runId = createRun(id, body.example ?? DEFAULT_REACTION_EXAMPLE, body.instruction ?? "mock");
      const reactions = seedMockReactions(id);
      runHub.emit({
        type: "agent_completed",
        run_id: runId,
        stage: "completed",
        message: `完成：${reactions.length} 条反应`,
        progress: 1,
        count: reactions.length,
      });
      return { run_id: runId, mock: true };
    }
    const { runId } = await runExtraction({
      documentId: id,
      example: body.example ?? DEFAULT_REACTION_EXAMPLE,
      instruction: body.instruction,
    });
    return { run_id: runId };
  });

  app.get("/api/agent/runs/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = getRun(runId);
    if (!run) return reply.code(404).send({ error: "run_not_found" });
    return {
      run: {
        ...run,
        schema: JSON.parse(run.schema_json),
        summary: run.summary_json ? JSON.parse(run.summary_json) : null,
      },
      events: runHub.history(runId),
    };
  });

  app.get("/api/agent/runs/:runId/events", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    if (!getRun(runId)) return reply.code(404).send({ error: "run_not_found" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const write = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    for (const event of runHub.history(runId)) {
      write(event);
    }

    const emitter = runHub.get(runId);
    const onEvent = (event: unknown) => write(event);
    emitter.on("event", onEvent);
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      emitter.off("event", onEvent);
    });
  });
}
