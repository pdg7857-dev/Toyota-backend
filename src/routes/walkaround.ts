import { Router } from "express";
import { prisma } from "../db/client.js";

export const walkaroundRouter: Router = Router();

// Returns curated walk-around notes (rep_notes tagged "walkaround") for a
// specific trim. If none exist, returns the trim + model notes so the rep
// can still cover the basics.
walkaroundRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: "missing_slug" });
    const trim = await prisma.trim.findUnique({
      where: { slug },
      include: { model: true, powertrain: true },
    });
    if (!trim) return res.status(404).json({ error: "trim_not_found" });

    const trimNotes = await prisma.repNote.findMany({
      where: {
        scopeType: "TRIM",
        scopeId: trim.id,
        tags: { has: "walkaround" },
      },
      orderBy: { updatedAt: "desc" },
    });

    const modelNotes = await prisma.repNote.findMany({
      where: { scopeType: "MODEL", scopeId: trim.modelId },
      orderBy: { updatedAt: "desc" },
    });

    res.json({
      trim: {
        slug: trim.slug,
        year: trim.year,
        name: trim.name,
        model: { slug: trim.model.slug, name: trim.model.name, make: trim.model.make },
        powertrain: trim.powertrain,
        towRatingLbs: trim.towRatingLbs,
        payloadLbs: trim.payloadLbs,
        notesMd: trim.notesMd,
      },
      walkaroundNotes: trimNotes,
      modelNotes,
    });
  } catch (e) {
    next(e);
  }
});
