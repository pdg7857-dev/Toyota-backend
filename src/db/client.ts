import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function bumpCatalogVersion(): Promise<number> {
  const updated = await prisma.meta.upsert({
    where: { id: 1 },
    create: { id: 1, catalogVersion: 1 },
    update: { catalogVersion: { increment: 1 } },
  });
  return updated.catalogVersion;
}

export async function getCatalogVersion(): Promise<number> {
  const meta = await prisma.meta.upsert({
    where: { id: 1 },
    create: { id: 1, catalogVersion: 1 },
    update: {},
  });
  return meta.catalogVersion;
}
