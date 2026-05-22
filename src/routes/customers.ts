import { Router } from "express";
import { z } from "zod";
import { CustomerInteractionKind, CustomerStatus } from "@prisma/client";
import { prisma } from "../db/client.js";

export const customersRouter: Router = Router();

const customerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.nativeEnum(CustomerStatus).optional(),
  vehicleOfInterestTrimId: z.number().int().positive().nullable().optional(),
  followUpDate: z.string().nullable().optional(),
  budgetCad: z.number().nonnegative().nullable().optional(),
  notesMd: z.string().nullable().optional(),
});

const interactionSchema = z.object({
  kind: z.nativeEnum(CustomerInteractionKind),
  bodyMd: z.string().min(1),
});

customersRouter.get("/", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? (req.query.status as CustomerStatus) : undefined;
    const dueOnly = req.query.dueOnly === "true";
    const list = await prisma.customer.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(dueOnly ? { followUpDate: { lte: new Date() } } : {}),
      },
      include: {
        vehicleOfInterest: { include: { model: true } },
        _count: { select: { interactions: true } },
      },
      orderBy: [{ followUpDate: "asc" }, { updatedAt: "desc" }],
    });
    res.json({ customers: list });
  } catch (e) {
    next(e);
  }
});

customersRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const c = await prisma.customer.findUnique({
      where: { id },
      include: {
        vehicleOfInterest: { include: { model: true, powertrain: true } },
        interactions: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!c) return res.status(404).json({ error: "not_found" });
    res.json(c);
  } catch (e) {
    next(e);
  }
});

customersRouter.post("/", async (req, res, next) => {
  try {
    const data = customerSchema.parse(req.body);
    const created = await prisma.customer.create({
      data: {
        ...data,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
      },
    });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

customersRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = customerSchema.partial().parse(req.body);
    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...data,
        followUpDate: data.followUpDate !== undefined ? (data.followUpDate ? new Date(data.followUpDate) : null) : undefined,
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

customersRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.customer.delete({ where: { id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

customersRouter.post("/:id/interactions", async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    const data = interactionSchema.parse(req.body);
    const row = await prisma.customerInteraction.create({ data: { ...data, customerId } });
    await prisma.customer.update({ where: { id: customerId }, data: { updatedAt: new Date() } });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});
