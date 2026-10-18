import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { tagListSchema } from "./tags";
const harness = z.enum([
  "Claude Code",
  "Codex",
  "Gemini CLI",
  "OpenCode",
  "Cursor",
  "Pi",
]);
const scope = z.enum(["user", "project"]);
export const inventorySchema = z.object({
  scannedAt: z.string(),
  truncated: z.boolean(),
  servers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      harness,
      source: z.string(),
      project: z.string().nullable(),
      scope,
      transport: z.enum(["stdio", "http", "sse", "ws", "unknown"]),
      state: z.enum(["configured", "disabled", "invalid"]),
    }),
  ),
  sources: z.array(
    z.object({
      harness,
      path: z.string(),
      scope,
      project: z.string().nullable(),
      status: z.enum(["loaded", "missing", "error"]),
      issue: z.string().nullable(),
    }),
  ),
});
const action = z.object({
  state: z.enum([
    "unknown",
    "connected",
    "failed",
    "credentials",
    "auth-required",
    "waiting",
    "complete",
    "manual",
  ]),
  message: z.string(),
  taskId: z.string().nullable(),
  url: z.string().nullable(),
  command: z.string().nullable(),
});
const target = z.object({ serverId: z.string().max(160) }).strict();
const hostTarget = target.extend({
  projects: z.array(z.string().max(1024)).max(20),
});
const task = z.object({ taskId: z.string().uuid() }).strict();
export const hostContract = defineRpcContract({
  remove: { input: hostTarget, output: z.null() },
  checkMany: {
    input: z
      .object({
        projects: z.array(z.string().max(1024)).max(20),
        serverIds: z.array(z.string().max(160)).max(250),
      })
      .strict(),
    output: z.record(z.string(), action),
  },
  check: { input: hostTarget, output: action },
  authenticate: { input: hostTarget, output: action },
  poll: { input: task, output: action },
  cancel: { input: task, output: action },
  scan: {
    input: z
      .object({ projects: z.array(z.string().max(1024)).max(20) })
      .strict(),
    output: inventorySchema,
  },
});
const snapshot = z.object({
  inventory: inventorySchema.nullable(),
  checks: z.record(
    z.string(),
    z.object({ pending: z.boolean(), result: action.nullable() }),
  ),
  pending: z.boolean(),
  error: z.string().nullable(),
});
export const rpcContract = defineRpcContract({
  tags: { input: z.null(), output: z.record(z.string(), tagListSchema) },
  setTags: {
    input: target.extend({ tags: tagListSchema }),
    output: tagListSchema,
  },
  remove: { input: target, output: z.null() },
  snapshot: { input: z.null(), output: snapshot },
  refresh: { input: z.null(), output: snapshot },
  check: { input: target, output: action },
  authenticate: { input: target, output: action },
  poll: { input: task, output: action },
  cancel: { input: task, output: action },
  inventory: { input: z.null(), output: inventorySchema },
});
