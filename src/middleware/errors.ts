import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "not_found" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation_error", details: err.flatten() });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (err.code === "P2002") {
      res.status(409).json({ error: "conflict", details: err.meta });
      return;
    }
  }
  const message = err instanceof Error ? err.message : "internal_error";
  console.error("[error]", err);
  res.status(500).json({ error: "internal_error", message });
}
