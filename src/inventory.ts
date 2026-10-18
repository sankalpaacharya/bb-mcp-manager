import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  parse as parseJson,
  type ParseError,
} from "jsonc-parser/lib/esm/main.js";

import type { Harness, Source, Server, Inventory } from "./model";
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}
const MAX_BYTES = 1024 * 1024;
const MAX_SERVERS = 250;

export function configSources(
  home: string,
  projects: string[],
  env: NodeJS.ProcessEnv,
): Source[] {
  const sources: Source[] = [];
  function add(harness: Harness, path: string, project: string | null = null) {
    if (!sources.some((s) => s.harness === harness && s.path === path)) {
      sources.push({
        harness,
        path,
        scope: project ? "project" : "user",
        project,
        status: "missing",
        issue: null,
      });
    }
  }
  add("Claude Code", join(env.CLAUDE_CONFIG_DIR || home, ".claude.json"));
  add("Codex", join(env.CODEX_HOME || join(home, ".codex"), "config.toml"));
  add("Gemini CLI", join(home, ".gemini/settings.json"));
  add("Cursor", join(home, ".cursor/mcp.json"));
  add("Pi", join(home, ".pi/agent/mcp.json"));
  const config = join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
  add("OpenCode", join(config, "opencode.json"));
  add("OpenCode", join(config, "opencode.jsonc"));
  if (env.OPENCODE_CONFIG && isAbsolute(env.OPENCODE_CONFIG))
    add("OpenCode", env.OPENCODE_CONFIG);
  for (const project of [...new Set(projects.map((p) => resolve(p)))]) {
    add("Claude Code", join(project, ".mcp.json"), project);
    add("Codex", join(project, ".codex/config.toml"), project);
    add("Gemini CLI", join(project, ".gemini/settings.json"), project);
    add("Cursor", join(project, ".cursor/mcp.json"), project);
    add("Pi", join(project, ".pi/mcp.json"), project);
    add("OpenCode", join(project, "opencode.json"), project);
    add("OpenCode", join(project, "opencode.jsonc"), project);
  }
  return sources;
}

// Project files may contain secrets in any field. Only this explicit allowlist
// crosses the host boundary; commands, URLs, arguments and credentials never do.
export function extractServers(value: unknown, source: Source): Server[] {
  const root = record(value);
  if (!root) throw new Error("invalid");
  const result: Server[] = [];
  function collect(container: RecordValue, project: string | null) {
    const key =
      source.harness === "Codex"
        ? "mcp_servers"
        : source.harness === "OpenCode"
          ? "mcp"
          : "mcpServers";
    if (container[key] === undefined) return;
    const entries = record(container[key]);
    if (!entries) throw new Error("invalid");
    for (const [name, raw] of Object.entries(entries)) {
      const entry = record(raw);
      const command = entry?.command;
      const local =
        typeof command === "string"
          ? command.trim().length > 0
          : Array.isArray(command) &&
            command.length > 0 &&
            command.every((v) => typeof v === "string");
      const url = entry?.url ?? entry?.httpUrl;
      const remote = typeof url === "string" && url.trim().length > 0;
      let transport: Server["transport"] = local
        ? "stdio"
        : remote
          ? "http"
          : "unknown";
      if (remote && entry?.type === "sse") transport = "sse";
      if (remote && entry?.type === "ws") transport = "ws";
      if (
        remote &&
        source.harness === "Gemini CLI" &&
        typeof entry?.url === "string"
      )
        transport = "sse";
      const state =
        entry?.enabled === false || entry?.disabled === true
          ? "disabled"
          : // Pi rejects SSE and accepts bare override entries that only set
            // enabled, exposure, or toolExposure for a user-level server.
            (source.harness === "Pi" && entry?.type === "sse") ||
              (transport === "unknown" &&
                !(
                  source.harness === "Pi" &&
                  entry &&
                  ("enabled" in entry ||
                    "exposure" in entry ||
                    "toolExposure" in entry)
                ))
            ? "invalid"
            : "configured";
      result.push({
        id: createHash("sha256")
          .update(JSON.stringify([source.harness, source.path, project, name]))
          .digest("hex"),
        name: name.slice(0, 160),
        harness: source.harness,
        source: source.path,
        project,
        scope: project ? "project" : source.scope,
        transport,
        state,
      });
      if (result.length > MAX_SERVERS) return;
    }
  }
  collect(root, source.project);
  if (source.harness === "Claude Code" && source.scope === "user") {
    const projects = record(root.projects);
    for (const [project, settings] of Object.entries(projects ?? {})) {
      const entry = record(settings);
      if (entry && isAbsolute(project) && project.length <= 1024)
        collect(entry, project);
      if (result.length > MAX_SERVERS) break;
    }
  }
  return result;
}

export async function scanInventory(
  options: {
    home?: string;
    projects?: string[];
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  } = {},
): Promise<Inventory> {
  const projects = options.projects ?? [];
  if (
    projects.length > 20 ||
    projects.some((p) => !isAbsolute(p) || p.length > 1024)
  )
    throw new Error(
      "Use at most 20 absolute project paths, each at most 1024 characters.",
    );
  const sources = configSources(
    options.home ?? homedir(),
    projects,
    options.env ?? process.env,
  );
  const servers: Server[] = [];
  let truncated = false;
  for (const source of sources) {
    options.signal?.throwIfAborted();
    let handle;
    try {
      // O_NONBLOCK avoids hanging on a FIFO supplied as a configuration file.
      handle = await open(
        source.path,
        constants.O_RDONLY | constants.O_NONBLOCK,
      );
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) {
        source.status = "error";
        source.issue = "Expected a regular file no larger than 1 MiB.";
        continue;
      }
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead,
        );
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > MAX_BYTES) {
        source.status = "error";
        source.issue = "File exceeds 1 MiB.";
        continue;
      }
      const content = buffer.subarray(0, bytesRead).toString("utf8");
      const errors: ParseError[] = [];
      const parsed: unknown = source.path.endsWith(".toml")
        ? parseToml(content)
        : parseJson(content, errors, { allowTrailingComma: true });
      if (errors.length) throw new Error("invalid");
      const found = extractServers(parsed, source);
      source.status = "loaded";
      for (const server of found) {
        if (servers.length >= MAX_SERVERS) {
          truncated = true;
          break;
        }
        servers.push(server);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      source.status = "error";
      // Never return parser errors: their snippets can contain credential values.
      source.issue =
        (error as NodeJS.ErrnoException).code === "EACCES"
          ? "Permission denied."
          : "Could not read or parse this configuration.";
    } finally {
      await handle?.close();
    }
  }
  return { scannedAt: new Date().toISOString(), servers, sources, truncated };
}
