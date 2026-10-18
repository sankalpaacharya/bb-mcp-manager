import type { Inventory, Server } from "../src/model";
const entries: Array<
  [string, Server["harness"], Server["transport"], Server["state"]]
> = [
  ["context7", "Claude Code", "http", "configured"],
  ["context7", "Codex", "http", "configured"],
  ["github", "Claude Code", "stdio", "configured"],
  ["github", "Codex", "stdio", "configured"],
  ["github", "Cursor", "http", "configured"],
  ["linear", "Claude Code", "http", "configured"],
  ["linear", "Pi", "http", "configured"],
  ["playwright", "Codex", "stdio", "configured"],
  ["playwright", "Cursor", "stdio", "configured"],
  ["filesystem", "Gemini CLI", "stdio", "disabled"],
  ["figma", "Cursor", "http", "configured"],
  ["notion", "OpenCode", "unknown", "invalid"],
  ["sequential-thinking", "Claude Code", "stdio", "configured"],
];
const paths: Record<Server["harness"], string> = {
  "Claude Code": "/home/demo/.claude.json",
  Codex: "/home/demo/.codex/config.toml",
  Cursor: "/home/demo/.cursor/mcp.json",
  "Gemini CLI": "/home/demo/.gemini/settings.json",
  OpenCode: "/home/demo/.config/opencode/opencode.json",
  Pi: "/home/demo/.pi/agent/mcp.json",
};
export const sampleInventory: Inventory = {
  scannedAt: "2026-09-23T09:41:00Z",
  truncated: false,
  servers: entries.map(([name, harness, transport, state], index) => ({
    id: String(index),
    name,
    harness,
    transport,
    state,
    source: paths[harness],
    scope: "user",
    project: null,
  })),
  sources: Object.entries(paths).map(([harness, path]) => ({
    harness: harness as Server["harness"],
    path,
    scope: "user",
    project: null,
    status: "loaded",
    issue: null,
  })),
};
