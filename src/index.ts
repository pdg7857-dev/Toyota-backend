import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { bearerAuth } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { modelsRouter } from "./routes/models.js";
import { trimsRouter } from "./routes/trims.js";
import { powertrainsRouter } from "./routes/powertrains.js";
import { warrantiesRouter } from "./routes/warranties.js";
import { financeRouter } from "./routes/finance.js";
import { notesRouter } from "./routes/notes.js";
import { aiRouter } from "./routes/ai.js";
import { adminRouter } from "./routes/admin.js";
import { compareRouter } from "./routes/compare.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, env: config.NODE_ENV });
  });

  app.get("/admin", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
  });

  const api = express.Router();
  api.use(bearerAuth);
  api.use("/models", modelsRouter);
  api.use("/trims", trimsRouter);
  api.use("/powertrains", powertrainsRouter);
  api.use("/warranties", warrantiesRouter);
  api.use("/finance-products", financeRouter);
  api.use("/rep-notes", notesRouter);
  api.use("/ai", aiRouter);
  api.use("/admin", adminRouter);
  api.use("/compare", compareRouter);
  app.use("/api/v1", api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`Toyota-backend listening on http://localhost:${config.PORT}`);
    console.log(`Health: http://localhost:${config.PORT}/health`);
    console.log(`Admin:  http://localhost:${config.PORT}/admin`);
  });
}
