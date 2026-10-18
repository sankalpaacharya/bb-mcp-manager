import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { Server } from "./model";

export interface ActionResult {
  state:
    | "unknown"
    | "connected"
    | "failed"
    | "credentials"
    | "auth-required"
    | "waiting"
    | "complete"
    | "manual";
  message: string;
  taskId: string | null;
  url: string | null;
  command: string | null;
}
export const result = (
  state: ActionResult["state"],
  message: string,
): ActionResult => ({ state, message, taskId: null, url: null, command: null });
const binaries = {
  "Claude Code": "claude",
  Codex: "codex",
  "Gemini CLI": "gemini",
  OpenCode: "opencode",
  Cursor: "agent",
  Pi: "pi",
};
export function parseStatus(server: Server, output: string): ActionResult {
  if (server.harness === "Pi") {
    try {
      const parsed: unknown = JSON.parse(output);
      const servers =
        parsed && typeof parsed === "object"
          ? (parsed as { servers?: unknown }).servers
          : null;
      const rows = Array.isArray(servers) ? servers : [];
      const matches = rows.filter((row) => row?.name === server.name);
      // A project entry replaces a user-level entry, so Pi reports one row per
      // name; prefer the row from this server's own configuration file.
      const row =
        matches.find((row) => row?.source === server.source) ??
        matches[0] ??
        null;
      if (!row) return result("unknown", "Not reported by Pi");
      switch (row.state) {
        case "connected":
          return result("connected", "Connected");
        case "needs-auth":
          return result("auth-required", "Sign-in required");
        case "disconnected":
        case "closed":
          return result("failed", "Not connected");
        case "disabled":
          return result("unknown", "Disabled in Pi");
        default:
          return result("unknown", "Connection not verified by Pi");
      }
    } catch {
      return result("unknown", "Could not read harness status");
    }
  }
  if (server.harness === "Codex") {
    try {
      const rows: unknown = JSON.parse(output);
      const row = Array.isArray(rows)
        ? rows.find((r) => r?.name === server.name)
        : null;
      if (row?.auth_status === "not_logged_in")
        return result("auth-required", "Sign-in required");
      if (["o_auth", "oauth", "bearer_token"].includes(row?.auth_status))
        return result(
          "credentials",
          "Credentials saved · connection not verified",
        );
      return result("unknown", "Connection not verified by Codex");
    } catch {
      return result("unknown", "Could not read harness status");
    }
  }
  const clean = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  // Claude get is scoped to a single server; other list formats are not stable enough to infer status safely.
  const status =
    server.harness === "Claude Code"
      ? (clean.split("\n").find((line) => /^\s*Status:/i.test(line)) ?? "")
      : "";
  if (/needs? auth|not authenticated/i.test(status))
    return result("auth-required", "Sign-in required");
  if (/failed|disconnected|rejected/i.test(status))
    return result("failed", "Not connected");
  if (/\bconnected\b/i.test(status)) return result("connected", "Connected");
  return result("unknown", "Status unavailable · check in the harness");
}
export function parseListStatus(server: Server, output: string): ActionResult {
  if (server.harness === "Codex" || server.harness === "Pi")
    return parseStatus(server, output);
  const clean = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const line = clean
    .split("\n")
    .find((line) => line.startsWith(server.name + ": "));
  if (!line)
    return result("unknown", "Not reported by this harness in this project");
  const marker = line.lastIndexOf(" - ");
  return marker < 0
    ? result("unknown", "Status unavailable")
    : parseStatus(server, "Status: " + line.slice(marker + 3));
}
export async function checkServers(
  servers: Server[],
  signal?: AbortSignal,
): Promise<Record<string, ActionResult>> {
  if (!servers.length) return {};
  const first = servers[0];
  if (
    servers.some(
      (server) =>
        server.harness !== first.harness || server.project !== first.project,
    )
  )
    throw new Error("Mixed harness contexts");
  if (
    first.harness !== "Claude Code" &&
    first.harness !== "Codex" &&
    first.harness !== "Pi"
  )
    return Object.fromEntries(
      servers.map((server) => [
        server.id,
        result("manual", `Check connection status in ${server.harness}.`),
      ]),
    );
  const args =
    first.harness === "Claude Code"
      ? ["mcp", "list"]
      : ["mcp", "list", "--json"];
  return new Promise((resolve) =>
    execFile(
      binaries[first.harness],
      args,
      {
        cwd: first.project ?? homedir(),
        signal,
        timeout: 20000,
        maxBuffer: 262144,
        env: { ...process.env, NO_COLOR: "1" },
      },
      (error, stdout) =>
        resolve(
          Object.fromEntries(
            servers.map((server) => [
              server.id,
              // Pi exits non-zero when an enabled server is not connected but
              // still reports every server on stdout.
              error && !(first.harness === "Pi" && stdout.trim())
                ? result(
                    "unknown",
                    "Status check failed. Check that the harness CLI is available.",
                  )
                : parseListStatus(server, stdout),
            ]),
          ),
        ),
    ),
  );
}
export async function checkServer(
  server: Server,
  signal?: AbortSignal,
): Promise<ActionResult> {
  return (await checkServers([server], signal))[server.id];
}
export function authorizationUrl(output: string): string | null {
  for (const match of output.matchAll(/https:\/\/[^\s<>"\x1b]+/g)) {
    try {
      const url = new URL(match[0]);
      if (
        url.href.length <= 8192 &&
        !url.username &&
        !url.password &&
        !url.hash &&
        url.searchParams.has("client_id") &&
        url.searchParams.has("response_type") &&
        !["access_token", "id_token", "code", "client_secret"].some((key) =>
          url.searchParams.has(key),
        )
      )
        return url.href;
    } catch {
      /* Ignore terminal fragments. */
    }
  }
  return null;
}
interface Job {
  serverId: string;
  value: ActionResult;
  child: ChildProcess;
  timer: ReturnType<typeof setTimeout>;
}
export class AuthJobs {
  private jobs = new Map<string, Job>();
  start(server: Server): ActionResult {
    const args =
      server.harness === "OpenCode"
        ? ["mcp", "auth", "--", server.name]
        : server.harness === "Pi"
          ? ["mcp", "login", server.name]
          : ["mcp", "login", "--", server.name];
    const command = [binaries[server.harness], ...args]
      .map((value) => `'${value.replaceAll("'", "'\\''")}'`)
      .join(" ");
    if (
      server.harness === "Gemini CLI" ||
      server.harness === "Cursor" ||
      server.transport === "stdio"
    )
      return {
        ...result(
          "manual",
          server.transport === "stdio"
            ? "Manage credentials for this local server in its harness."
            : `Complete sign-in in ${server.harness}.`,
        ),
        command:
          server.harness === "Gemini CLI"
            ? `/mcp auth ${server.name}`
            : command,
      };
    for (const job of this.jobs.values())
      if (job.serverId === server.id && job.value.state === "waiting")
        return { ...job.value };
    if (
      [...this.jobs.values()].filter((job) => job.value.state === "waiting")
        .length >= 3
    )
      return result("failed", "Finish an existing sign-in first.");
    for (const [id, job] of this.jobs)
      if (this.jobs.size >= 20 && job.value.state !== "waiting")
        this.jobs.delete(id);
    const id = randomUUID();
    // Claude's OAuth fallback requires a TTY even when a browser is launched.
    // util-linux script supplies one while preserving bounded output and cancellation.
    const terminal = process.platform === "linux";
    const child = spawn(
      terminal ? "script" : binaries[server.harness],
      terminal
        ? ["--quiet", "--return", "--command", command, "/dev/null"]
        : args,
      {
        cwd: server.project ?? homedir(),
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        // Native OAuth owns the localhost callback. Override inherited IDE browser
        // launchers so the harness opens the host desktop's default browser.
        env: {
          ...process.env,
          NO_COLOR: "1",
          ...(process.platform === "linux"
            ? { BROWSER: "xdg-open" }
            : process.platform === "darwin"
              ? { BROWSER: "open" }
              : {}),
        },
      },
    );
    const job: Job = {
      serverId: server.id,
      child,
      value: {
        ...result("waiting", "Complete sign-in in your default browser."),
        taskId: id,
        command,
      },
      timer: setTimeout(
        () =>
          this.stop(
            id,
            "Sign-in timed out. Run the command in your harness terminal.",
          ),
        300000,
      ),
    };
    this.jobs.set(id, job);
    let output = "";
    const read = (chunk: Buffer) => {
      if (job.value.state !== "waiting") return;
      output += chunk.toString();
      if (output.length > 262144) {
        this.stop(
          id,
          "Sign-in output exceeded the limit. Use the harness terminal.",
        );
        return;
      }
      job.value.url = authorizationUrl(output);
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    const finish = (ok: boolean) => {
      clearTimeout(job.timer);
      if (job.value.state !== "waiting") return;
      job.value = {
        ...job.value,
        state: ok ? "complete" : "failed",
        url: null,
        message: ok
          ? "Sign-in completed. Refresh to verify the connection."
          : "The harness could not start browser sign-in. Check the server’s OAuth configuration and try again.",
      };
      output = "";
    };
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    return { ...job.value };
  }
  poll(id: string): ActionResult {
    return {
      ...(this.jobs.get(id)?.value ??
        result("failed", "Sign-in expired. Try again.")),
    };
  }
  stop(id: string, message = "Sign-in cancelled."): ActionResult {
    const job = this.jobs.get(id);
    if (!job || job.value.state !== "waiting") return this.poll(id);
    clearTimeout(job.timer);
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && job.child.pid)
          process.kill(-job.child.pid, signal);
        else job.child.kill(signal);
      } catch {
        /* Already exited. */
      }
    };
    kill("SIGTERM");
    const force = setTimeout(() => kill("SIGKILL"), 2000);
    force.unref();
    job.child.once("close", () => clearTimeout(force));
    job.value = { ...job.value, state: "failed", message, url: null };
    return { ...job.value };
  }
  dispose() {
    for (const id of this.jobs.keys()) this.stop(id);
  }
}
