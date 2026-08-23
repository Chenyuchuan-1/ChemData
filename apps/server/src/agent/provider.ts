import { config } from "../config.js";

export function resolveLlmModel(): string {
  const configured = config.llm.model.trim();
  return configured.replace(/^openai\/responses\//, "").replace(/^openai\//, "") || configured;
}

export function llmModelCandidates(): string[] {
  return [...new Set([resolveLlmModel(), config.llm.model.trim(), "gpt-5.6-sol"].filter(Boolean))];
}

export function createCompatibleModel() {
  const input = config.llm.supportsVision ? (["text", "image"] as const) : (["text"] as const);
  const modelId = resolveLlmModel();
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions" as const,
    provider: config.llm.provider,
    baseUrl: config.llm.baseUrl.replace(/\/$/, ""),
    reasoning: false,
    input: [...input],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: config.llm.maxTokens,
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens" as const,
    },
  };
}

async function postLlm(pathname: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
  try {
    const response = await fetch(`${config.llm.baseUrl.replace(/\/$/, "")}${pathname}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`LLM ${response.status}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export async function chatCompletions(messages: Array<Record<string, unknown>>, extra?: Record<string, unknown>) {
  let lastError: unknown;
  for (const model of llmModelCandidates()) {
    const body = {
      model,
      temperature: config.llm.temperature,
      max_tokens: Math.min(config.llm.maxTokens, 4000),
      messages,
      ...extra,
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const payload = await postLlm("/chat/completions", body);
        return payload as { choices?: Array<{ message?: { content?: string } }> };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("404") && !message.includes("503")) {
          try {
            const responses = await postLlm("/responses", {
              model,
              input: messages.map((item) => String(item.content ?? "")).join("\n"),
            });
            const text =
              (responses as { output_text?: string }).output_text ??
              JSON.stringify(responses);
            return { choices: [{ message: { content: text } }] };
          } catch (responsesError) {
            lastError = responsesError;
          }
        }
        if (message.includes("401") || message.includes("403")) break;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function analyzeReactionImage(input: {
  imagePath: string;
  context: string;
  schema: unknown;
}): Promise<unknown | null> {
  if (!config.llm.supportsVision) return null;
  const fs = await import("node:fs");
  if (!fs.existsSync(input.imagePath)) return null;
  const base64 = fs.readFileSync(input.imagePath).toString("base64");
  const payload = await chatCompletions([
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Extract the reaction from this image. Use only visible evidence. Missing fields must be null. Return JSON only matching this schema example:\n${JSON.stringify(input.schema, null, 2)}\n\nContext:\n${input.context}`,
        },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${base64}` },
        },
      ],
    },
  ]);
  return payload.choices?.[0]?.message?.content ?? null;
}
