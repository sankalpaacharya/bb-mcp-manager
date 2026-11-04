export const HARNESSES = [
  "Claude Code",
  "Codex",
  "Gemini CLI",
  "OpenCode",
  "Cursor",
  "Pi",
] as const;
export type Harness = (typeof HARNESSES)[number];
export interface Source {
  harness: Harness;
  path: string;
  scope: "user" | "project";
  project: string | null;
  status: "loaded" | "missing" | "error";
  issue: string | null;
}
export interface Server {
  id: string;
  name: string;
  harness: Harness;
  source: string;
  project: string | null;
  scope: "user" | "project";
  transport: "stdio" | "http" | "sse" | "ws" | "unknown";
  state: "configured" | "disabled" | "invalid";
}
export interface Inventory {
  scannedAt: string;
  servers: Server[];
  sources: Source[];
  truncated: boolean;
}
export function mergeConnections(servers: Server[]): Server[][] {
  const groups = new Map<string, Server[]>();
  for (const server of servers) {
    const key = JSON.stringify([server.harness, server.name]);
    groups.set(key, [...(groups.get(key) ?? []), server]);
  }
  return [...groups.values()];
}
