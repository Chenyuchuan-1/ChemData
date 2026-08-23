import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: path.join(rootDir, ".env") });

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const config = {
  rootDir,
  env: env("APP_ENV", "development"),
  host: env("SERVER_HOST", "127.0.0.1"),
  port: Number(env("SERVER_PORT", "3001")),
  storageRoot: path.resolve(rootDir, env("STORAGE_ROOT", "./data")),
  databaseUrl: env("DATABASE_URL", "sqlite:///./data/app.db"),
  scientificUrl: env("SCIENTIFIC_URL", "http://127.0.0.1:8100"),
  mineru: {
    mode: env("MINERU_MODE", "api"),
    apiUrl: env("MINERU_API_URL", "http://127.0.0.1:8000"),
    backend: env("MINERU_BACKEND", "pipeline"),
    maxPages: Number(env("MINERU_MAX_PAGES", "0")),
    chunkPages: process.env.MINERU_CHUNK_PAGES ? Number(process.env.MINERU_CHUNK_PAGES) : undefined,
    chunkOverlap: process.env.MINERU_CHUNK_OVERLAP ? Number(process.env.MINERU_CHUNK_OVERLAP) : undefined,
    autoChunkPages: Number(env("MINERU_AUTO_CHUNK_PAGES", "24")),
    autoChunkBytes: Number(env("MINERU_AUTO_CHUNK_BYTES", String(20 * 1024 * 1024))),
    uploadLimitBytes: Number(env("UPLOAD_LIMIT_BYTES", String(512 * 1024 * 1024))),
  },
  llm: {
    provider: env("LLM_PROVIDER", "openai-compatible"),
    baseUrl: env("LLM_BASE_URL", "http://127.0.0.1:8001/v1"),
    apiKey: env("LLM_API_KEY", "your-api-key"),
    model: env("LLM_MODEL", "gpt-5.6-sol"),
    apiType: env("LLM_API_TYPE", "openai-completions"),
    temperature: Number(env("LLM_TEMPERATURE", "0")),
    maxTokens: Number(env("LLM_MAX_TOKENS", "16000")),
    timeoutMs: Number(env("LLM_TIMEOUT_MS", "180000")),
    supportsVision: envBool("LLM_SUPPORTS_VISION", true),
  },
};

export function documentDir(documentId: string): string {
  return path.join(config.storageRoot, "documents", documentId);
}
