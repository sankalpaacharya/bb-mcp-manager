import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { result, type ActionResult } from "./actions";

// Launch settings come from `codex mcp list --json`, which reports the
// effective configuration for the project context. Values may hold
// credentials: they are only passed to the server and never logged or returned.
export interface CodexRow {
  name?: unknown;
  enabled?: unknown;
  auth_status?: unknown;
  startup_timeout_sec?: unknown;
  transport?: unknown;
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bb-mcp-manager", version: "0" },
  },
};
const MAX_OUTPUT = 1048576;
// Codex starts stdio servers with this environment plus `env` and `env_vars`.
const CODEX_BASE_ENV =
  process.platform === "win32"
    ? [
        "PATH",
        "PATHEXT",
        "COMSPEC",
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "USERNAME",
        "USERDOMAIN",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "PROGRAMW6432",
        "PROGRAMDATA",
        "LOCALAPPDATA",
        "APPDATA",
        "TEMP",
        "TMP",
        "POWERSHELL",
        "PWSH",
      ]
    : [
        "HOME",
        "LOGNAME",
        "PATH",
        "SHELL",
        "USER",
        "__CF_USER_TEXT_ENCODING",
        "LANG",
        "LC_ALL",
        "TERM",
        "TMPDIR",
        "TZ",
      ];

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

export function timeoutMs(row: CodexRow): number {
  const seconds =
    typeof row.startup_timeout_sec === "number" &&
    Number.isFinite(row.startup_timeout_sec)
      ? row.startup_timeout_sec
      : 30;
  return Math.round(Math.min(Math.max(seconds, 5), 120) * 1000);
}

export function stdioEnv(
  transport: Record<string, unknown>,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const names = [...CODEX_BASE_ENV];
  if (Array.isArray(transport.env_vars))
    for (const item of transport.env_vars) {
      const name =
        typeof item === "string"
          ? item
          : typeof record(item).name === "string"
            ? (record(item).name as string)
            : null;
      if (name) names.push(name);
    }
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = parent[name];
    if (typeof value === "string") env[name] = value;
  }
  return { ...env, ...strings(transport.env) };
}

export function httpHeaders(
  transport: Record<string, unknown>,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> | null {
  if (transport.http_headers_helper != null) return null;
  const headers = strings(transport.http_headers);
  for (const [header, variable] of Object.entries(
    strings(transport.env_http_headers),
  )) {
    const value = parent[variable];
    if (typeof value === "string" && value) headers[header] = value;
  }
  if (typeof transport.bearer_token_env_var === "string") {
    const token = parent[transport.bearer_token_env_var];
    if (!token) return null;
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function probeStdio(
  input: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
    timeoutMs: number;
  },
  signal?: AbortSignal,
): Promise<ActionResult> {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "ignore"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        /* Already exited. */
      }
    };
    const finish = (value: ActionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      child.stdout?.removeAllListeners("data");
      child.stdin?.end();
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 2000).unref();
      resolve(value);
    };
    const abort = () => finish(result("unknown", "Check cancelled."));
    const timer = setTimeout(
      () =>
        finish(
          result(
            "failed",
            `No MCP response within ${Math.round(input.timeoutMs / 1000)}s`,
          ),
        ),
      input.timeoutMs,
    );
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () =>
      finish(result("failed", "Server command could not be started")),
    );
    child.once("exit", (code) =>
      finish(
        result(
          "failed",
          `Server exited before responding${code == null ? "" : ` (code ${code})`}`,
        ),
      ),
    );
    child.stdin?.on("error", () => {
      /* Reported through exit. */
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > MAX_OUTPUT)
        return finish(result("failed", "Server output exceeded the limit"));
      let newline: number;
      while ((newline = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, newline).trim();
        output = output.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        try {
          const message = record(JSON.parse(line));
          if (message.id !== 1) continue;
          return finish(
            "result" in message
              ? result("connected", "Connected")
              : result("failed", "Server rejected the MCP handshake"),
          );
        } catch {
          /* Servers may log non-JSON lines to stdout. */
        }
      }
    });
    child.stdin?.write(JSON.stringify(INITIALIZE) + "\n");
  });
}

export async function probeHttp(
  input: { url: string; headers: Record<string, string>; timeoutMs: number },
  signal?: AbortSignal,
): Promise<ActionResult> {
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: "POST",
      headers: {
        ...input.headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(INITIALIZE),
      signal: combined,
      redirect: "follow",
    });
  } catch {
    if (signal?.aborted) return result("unknown", "Check cancelled.");
    return timeout.aborted
      ? result(
          "failed",
          `No MCP response within ${Math.round(input.timeoutMs / 1000)}s`,
        )
      : result("failed", "Server is unreachable");
  }
  await response.body?.cancel().catch(() => {});
  const session = response.headers.get("mcp-session-id");
  if (session)
    // End the probe session; failures are irrelevant to the result.
    void fetch(input.url, {
      method: "DELETE",
      headers: { ...input.headers, "Mcp-Session-Id": session },
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  if (response.ok) return result("connected", "Connected");
  if (response.status === 401)
    return result("auth-required", "Sign-in required");
  return result("failed", `Not connected (HTTP ${response.status})`);
}

// Returns null when the row cannot be reproduced outside Codex; the caller
// keeps Codex's own credential status in that case.
export function probeCodex(
  row: CodexRow,
  project: string | null,
  signal?: AbortSignal,
): Promise<ActionResult> | null {
  if (row.enabled === false) return null;
  const transport = record(row.transport);
  const limit = timeoutMs(row);
  if (transport.type === "stdio" && typeof transport.command === "string") {
    const args = Array.isArray(transport.args)
      ? transport.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    const base = project ?? homedir();
    const cwd =
      typeof transport.cwd === "string" && transport.cwd
        ? resolve(base, transport.cwd)
        : base;
    return probeStdio(
      {
        command: transport.command,
        args,
        env: stdioEnv(transport),
        cwd,
        timeoutMs: limit,
      },
      signal,
    );
  }
  if (
    transport.type === "streamable_http" &&
    typeof transport.url === "string" &&
    // OAuth tokens live in Codex's credential store and cannot be reused here.
    !["o_auth", "oauth", "not_logged_in"].includes(String(row.auth_status))
  ) {
    const headers = httpHeaders(transport);
    if (!headers) return null;
    return probeHttp({ url: transport.url, headers, timeoutMs: limit }, signal);
  }
  return null;
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return output;
}
