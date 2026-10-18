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
