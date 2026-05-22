// Shared Prisma client for the comparison site Server Components.
//
// Reuses the parent Toyota-backend Prisma client (../node_modules/@prisma/client)
// so the schema stays single-source. In dev the global cache prevents Next.js'
// hot-reload from spawning a new connection on every request.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
