import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  API_TOKEN: z.string().min(16, "API_TOKEN must be at least 16 chars"),
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
