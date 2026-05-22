import { Router } from "express";
import { z } from "zod";
import { ConversationRole } from "@prisma/client";
import { config } from "../config.js";
import { buildCatalogContext } from "../services/ai/context-builder.js";
import { ask, type PriorTurn } from "../services/ai/client.js";
import { SYSTEM_PROMPT } from "../services/ai/prompts.js";
import { prisma, getCatalogVersion } from "../db/client.js";

export const aiRouter: Router = Router();

const askSchema = z.object({
  question: z.string().min(1),
  model: z.enum(["haiku", "sonnet"]).optional(),
  conversationId: z.number().int().positive().optional(),
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

aiRouter.get("/conversations", async (_req, res, next) => {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { _count: { select: { messages: true } } },
    });
    res.json({ conversations });
  } catch (e) {
    next(e);
  }
});

aiRouter.get("/conversations/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const conv = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conv) return res.status(404).json({ error: "not_found" });
    res.json(conv);
  } catch (e) {
    next(e);
  }
});

aiRouter.delete("/conversations/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.conversation.delete({ where: { id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

aiRouter.post("/ask", async (req, res, next) => {
  try {
    const { question, model, conversationId } = askSchema.parse(req.body);

    // Load prior turns if continuing an existing conversation.
    let priorTurns: PriorTurn[] = [];
    if (conversationId) {
      const existing = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!existing) return res.status(404).json({ error: "conversation_not_found" });
      priorTurns = existing.messages.map((m) => ({
        role: m.role === ConversationRole.ASSISTANT ? "assistant" : "user",
        content: m.content,
      }));
    }

    const ctx = await buildCatalogContext({ text: question });
    const result = await ask({ question, modelChoice: model, priorTurns }, ctx);

    // Persist only after the AI call succeeds so failed calls don't leave
    // empty conversation rows behind.
    const persistedId = await prisma.$transaction(async (tx) => {
      const conv = conversationId
        ? await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
        : await tx.conversation.create({ data: { title: question.slice(0, 80) } });
      await tx.conversationMessage.create({
        data: { conversationId: conv.id, role: ConversationRole.USER, content: question },
      });
      await tx.conversationMessage.create({
        data: {
          conversationId: conv.id,
          role: ConversationRole.ASSISTANT,
          content: result.answer,
          modelUsed: result.model,
          citationsJson: result.citations as never,
          cachedInputTokens: result.cachedInputTokens,
          uncachedInputTokens: result.uncachedInputTokens,
          outputTokens: result.outputTokens,
        },
      });
      return conv.id;
    });

    res.json({
      ...result,
      conversationId: persistedId,
      catalogVersion: ctx.catalogVersion,
      scopedModels: ctx.scopedModels,
    });
  } catch (e) {
    next(e);
  }
});
