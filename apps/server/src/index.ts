import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerReactionRoutes } from "./routes/reactions.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerBatchRoutes } from "./routes/batch.js";
import { scientific } from "./services/scientific.js";
import { resolveLlmModel } from "./agent/provider.js";

const app = Fastify({
  logger: true,
  bodyLimit: config.mineru.uploadLimitBytes,
  requestTimeout: 0,
  connectionTimeout: 0,
});

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: config.mineru.uploadLimitBytes } });

app.get("/api/health", async () => {
  let scientificStatus: unknown = { ok: false };
  try {
    scientificStatus = await scientific.health();
  } catch (error) {
    scientificStatus = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return {
    ok: true,
    service: "agent-server",
    llm_model: config.llm.model,
    llm_resolved_model: resolveLlmModel(),
    llm_base_url: config.llm.baseUrl,
    scientific: scientificStatus,
  };
});

await registerDocumentRoutes(app);
await registerAgentRoutes(app);
await registerReactionRoutes(app);
await registerExportRoutes(app);
await registerBatchRoutes(app);

await app.listen({ host: config.host, port: config.port });
console.log(`Agent server listening on http://${config.host}:${config.port}`);
