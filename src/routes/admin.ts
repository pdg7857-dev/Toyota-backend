import { Router } from "express";
import { z } from "zod";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScrapeDiffDecision } from "@prisma/client";
import { prisma } from "../db/client.js";
import { applyAcceptedDiffs } from "../scraper/diff.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const adminRouter: Router = Router();

const runRequestSchema = z.object({
  models: z.array(z.string()).optional(),
});

const decisionsSchema = z.object({
  decisions: z.array(
    z.object({
      diffId: z.number().int().positive(),
      decision: z.nativeEnum(ScrapeDiffDecision),
    }),
  ),
});

adminRouter.post("/scrape/run", async (req, res, next) => {
  try {
    const { models } = runRequestSchema.parse(req.body ?? {});
    // Create the run row up front so we can return its id immediately. The
    // scraper child process picks it up via --run-id.
    const run = await prisma.scrapeRun.create({ data: { source: "toyota.ca", status: "PENDING_REVIEW" } });

    const scriptPath = path.resolve(__dirname, "../scraper/run.ts");
    const args = ["--env-file=.env", scriptPath, "--run-id", String(run.id)];
    if (models && models.length > 0) args.push("--models", models.join(","));

    const child = spawn("npx", ["tsx", ...args], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();

    res.status(202).json({ runId: run.id, status: "started" });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/scrape/runs", async (_req, res, next) => {
  try {
    const runs = await prisma.scrapeRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { _count: { select: { diffs: true } } },
    });
    res.json({ runs });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/scrape/runs/:id/diffs", async (req, res, next) => {
  try {
    const runId = Number(req.params.id);
    const diffs = await prisma.scrapeDiff.findMany({
      where: { runId },
      orderBy: [{ tableName: "asc" }, { recordPk: "asc" }, { field: "asc" }],
    });
    res.json({ runId, diffs });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch("/scrape/runs/:id/diffs", async (req, res, next) => {
  try {
    const runId = Number(req.params.id);
    const { decisions } = decisionsSchema.parse(req.body);
    await prisma.$transaction(
      decisions.map((d) =>
        prisma.scrapeDiff.update({
          where: { id: d.diffId },
          data: { decision: d.decision },
        }),
      ),
    );
    const updated = await prisma.scrapeDiff.findMany({ where: { runId } });
    res.json({ runId, diffs: updated });
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/scrape/runs/:id/apply", async (req, res, next) => {
  try {
    const runId = Number(req.params.id);
    const result = await applyAcceptedDiffs(runId);
    res.json({ runId, ...result });
  } catch (e) {
    next(e);
  }
});
