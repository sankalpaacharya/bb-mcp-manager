import { lstat, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  parse,
  modify,
  applyEdits,
  type ParseError,
} from "jsonc-parser/lib/esm/main.js";
import type { Server } from "./model";

// Mirrors the reader: OpenCode 2 keeps servers in `mcp.servers`.
function openCodePath(root: Record<string, unknown>): string[] {
  const mcp = root.mcp;
  const nested =
    mcp !== null && typeof mcp === "object" && !Array.isArray(mcp)
      ? (mcp as Record<string, unknown>)
      : null;
  return nested && Object.hasOwn(nested, "servers")
    ? ["mcp", "servers"]
    : ["mcp"];
}

export function withoutServer(text: string, server: Server): string {
  if (server.name.length >= 160)
    throw new Error("Server name is too long to remove safely.");
  const toml = server.harness === "Codex";
  const errors: ParseError[] = [];
  const root = toml
    ? parseToml(text)
    : parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !root || typeof root !== "object")
    throw new Error("Invalid configuration");
  const key = toml
    ? ["mcp_servers"]
    : server.harness === "OpenCode"
      ? openCodePath(root as Record<string, unknown>)
      : ["mcpServers"];
  const nested =
    server.harness === "Claude Code" &&
    server.project &&
    !server.source.endsWith("/.mcp.json");
  const path = nested
    ? ["projects", server.project!, ...key, server.name]
    : [...key, server.name];
  let container = root;
  for (const part of path.slice(0, -1)) {
    if (
      !container ||
      typeof container !== "object" ||
      !Object.hasOwn(container, part)
    )
      throw new Error("Entry no longer exists");
    container = container[part];
  }
  if (!container || !Object.hasOwn(container, server.name))
    throw new Error("Entry no longer exists");
  if (toml) {
    delete container[server.name];
    return stringifyToml(root);
  }
  return applyEdits(
    text,
    modify(text, path, undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}
const active = new Set<string>();
export async function removeServer(server: Server): Promise<void> {
  if (active.has(server.source))
    throw new Error("Configuration is being updated. Try again.");
  active.add(server.source);
  const temporary = server.source + "." + randomUUID() + ".tmp";
  try {
    const before = await lstat(server.source);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 1048576)
      throw new Error("Unsupported configuration file");
    const original = await readFile(server.source, "utf8");
    const updated = withoutServer(original, server);
    await writeFile(server.source + ".backup-" + randomUUID(), original, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(temporary, updated, {
      flag: "wx",
      mode: before.mode & 0o777,
    });
    const current = await lstat(server.source);
    if (
      current.ino !== before.ino ||
      current.mtimeMs !== before.mtimeMs ||
      (await readFile(server.source, "utf8")) !== original
    )
      throw new Error("Configuration changed. Refresh and try again.");
    await rename(temporary, server.source);
  } finally {
    active.delete(server.source);
    await unlink(temporary).catch(() => {});
  }
}
