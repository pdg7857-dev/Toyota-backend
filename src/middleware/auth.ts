import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

export function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || match[1] !== config.API_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
