import { Agent } from "@mariozechner/pi-agent-core";
import { config } from "../config.js";
import { DOCUMENT_EXTRACTION_SYSTEM_PROMPT } from "./system-prompt.js";
import { createCompatibleModel } from "./provider.js";
import { createDocumentTools, type ToolContext } from "./tools/index.js";

export function createDocumentAgent(ctx: ToolContext) {
  const model = createCompatibleModel();
  const tools = createDocumentTools(ctx);

  const agent = new Agent({
    initialState: {
      systemPrompt: DOCUMENT_EXTRACTION_SYSTEM_PROMPT,
      model,
      tools,
      thinkingLevel: "off",
      messages: [],
    },
    getApiKey: () => config.llm.apiKey,
  });

  return { agent, tools, model };
}
