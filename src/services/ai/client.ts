import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import type { CatalogContext } from "./context-builder.js";

const DEFAULT_MODEL = "claude-haiku-4-5";
const HIGH_QUALITY_MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

export type PriorTurn = { role: "user" | "assistant"; content: string };

export type AskOptions = {
  question: string;
  modelChoice?: "haiku" | "sonnet";
  priorTurns?: PriorTurn[];
};

export type AskResult = {
  answer: string;
  citations: Array<{ type: string; id: string | number }>;
  model: string;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
};

function parseCitations(text: string): { answer: string; citations: AskResult["citations"] } {
  const fenceRe = /```json\s*([\s\S]*?)```/g;
  let citations: AskResult["citations"] = [];
  let cleaned = text;
  const matches = [...text.matchAll(fenceRe)];
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1] ?? "");
      if (parsed && Array.isArray(parsed.citations)) {
        citations = parsed.citations;
        cleaned = cleaned.replace(m[0], "").trim();
      }
    } catch {
      // ignore non-citation JSON blocks
    }
  }
  return { answer: cleaned, citations };
}

export async function ask({ question, modelChoice, priorTurns }: AskOptions, ctx: CatalogContext): Promise<AskResult> {
  const model = modelChoice === "sonnet" ? HIGH_QUALITY_MODEL : DEFAULT_MODEL;
  const anthropic = getClient();

  const messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: "text"; text: string }> }> = [];
  for (const t of priorTurns ?? []) {
    messages.push({ role: t.role, content: t.content });
  }
  messages.push({
    role: "user",
    content: [
      ...(ctx.scopedBlock
        ? [{ type: "text" as const, text: `Relevant additional detail:\n${ctx.scopedBlock}` }]
        : []),
      { type: "text" as const, text: `Question from the rep:\n${question}` },
    ],
  });

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: ctx.fullCatalogBlock, cache_control: { type: "ephemeral" } },
    ],
    messages,
  });

  const textBlocks = response.content.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text");
  const raw = textBlocks.map((b) => b.text).join("\n");
  const { answer, citations } = parseCitations(raw);

  const usage = response.usage as unknown as {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };

  return {
    answer,
    citations,
    model: response.model,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    uncachedInputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}
