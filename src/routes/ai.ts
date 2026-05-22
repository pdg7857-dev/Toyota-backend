import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { buildCatalogContext } from "../services/ai/context-builder.js";
import { ask } from "../services/ai/client.js";
import { SYSTEM_PROMPT } from "../services/ai/prompts.js";
import { getCatalogVersion } from "../db/client.js";

export const aiRouter: Router = Router();

const askSchema = z.object({
  question: z.string().min(1),
  model: z.enum(["haiku", "sonnet"]).optional(),
});

aiRouter.get("/health", async (_req, res, next) => {
  try {
    const catalogVersion = await getCatalogVersion();
    res.json({
      ok: Boolean(config.ANTHROPIC_API_KEY),
      anthropicConfigured: Boolean(config.ANTHROPIC_API_KEY),
      defaultModel: "claude-haiku-4-5",
      optInModel: "claude-sonnet-4-6",
      catalogVersion,
      systemPromptLength: SYSTEM_PROMPT.length,
    });
  } catch (e) {
    next(e);
  }
});

aiRouter.get("/context-preview", async (req, res, next) => {
  try {
    const question = typeof req.query.question === "string" ? req.query.question : "";
    if (!question) return res.status(400).json({ error: "missing_question" });
    const ctx = await buildCatalogContext({ text: question });
    res.json({
      question,
      catalogVersion: ctx.catalogVersion,
      scopedModels: ctx.scopedModels,
      systemPrompt: SYSTEM_PROMPT,
      fullCatalogBlock: ctx.fullCatalogBlock,
      scopedBlock: ctx.scopedBlock,
      sizes: {
        systemPromptChars: SYSTEM_PROMPT.length,
        fullCatalogChars: ctx.fullCatalogBlock.length,
        scopedBlockChars: ctx.scopedBlock.length,
      },
    });
  } catch (e) {
    next(e);
  }
});

aiRouter.post("/ask", async (req, res, next) => {
  try {
    const { question, model } = askSchema.parse(req.body);
    const ctx = await buildCatalogContext({ text: question });
    const result = await ask({ question, modelChoice: model }, ctx);
    res.json({
      ...result,
      catalogVersion: ctx.catalogVersion,
      scopedModels: ctx.scopedModels,
    });
  } catch (e) {
    next(e);
  }
});
