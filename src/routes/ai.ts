import { Router } from "express";
import { z } from "zod";
import { buildCatalogContext } from "../services/ai/context-builder.js";
import { ask } from "../services/ai/client.js";

export const aiRouter: Router = Router();

const askSchema = z.object({
  question: z.string().min(1),
  model: z.enum(["haiku", "sonnet"]).optional(),
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
