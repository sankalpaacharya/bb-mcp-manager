import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  httpHeaders,
  mapLimit,
  probeCodex,
  probeHttp,
  probeStdio,
  stdioEnv,
  timeoutMs,
} from "../src/probe";

const node = process.execPath;
const stdio = (script: string, limit = 5000) =>
  probeStdio({
    command: node,
    args: ["-e", script],
    env: { PATH: process.env.PATH ?? "" },
    cwd: process.cwd(),
    timeoutMs: limit,
  });
const respond = `process.stdin.once("data", () => {
  console.log("starting up");
  console.log(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } } }));
}); setInterval(() => {}, 1000);`;

test("stdio handshake proves a connection", async () => {
  const value = await stdio(respond);
  assert.equal(value.state, "connected");
});
test("stdio failures are reported without output", async () => {
  const exited = await stdio(`console.error("secret-token"); process.exit(3)`);
  assert.equal(exited.state, "failed");
  assert.match(exited.message, /code 3/);
  assert.doesNotMatch(exited.message, /secret/);
  const rejected = await stdio(
    `process.stdin.once("data", () => console.log(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "secret" } }))); setInterval(() => {}, 1000);`,
  );
  assert.equal(rejected.state, "failed");
  assert.doesNotMatch(rejected.message, /secret/);
  const silent = await stdio(`setInterval(() => {}, 1000)`, 300);
  assert.equal(silent.state, "failed");
  assert.match(silent.message, /No MCP response/);
  const missing = await probeStdio({
    command: "/nonexistent/mcp-server",
    args: [],
    env: {},
    cwd: process.cwd(),
    timeoutMs: 5000,
  });
  assert.equal(missing.state, "failed");
});
test("stdio checks stop when cancelled", async () => {
  const controller = new AbortController();
  const pending = probeStdio(
    {
      command: node,
      args: ["-e", "setInterval(() => {}, 1000)"],
      env: {},
      cwd: process.cwd(),
      timeoutMs: 60000,
    },
    controller.signal,
  );
  controller.abort();
  assert.equal((await pending).state, "unknown");
});
test("stdio environment matches Codex launch rules", () => {
  const env = stdioEnv(
    { env: { API_KEY: "k" }, env_vars: ["EXTRA", { name: "OTHER" }] },
    { PATH: "/bin", HOME: "/h", EXTRA: "1", OTHER: "2", UNRELATED: "x" },
  );
  assert.deepEqual(env, {
    PATH: "/bin",
    HOME: "/h",
    EXTRA: "1",
    OTHER: "2",
    API_KEY: "k",
  });
});
test("http headers resolve Codex credential settings", () => {
  assert.deepEqual(
    httpHeaders(
      {
        http_headers: { "X-Static": "a" },
        env_http_headers: { "X-Env": "ENV_HEADER" },
        bearer_token_env_var: "TOKEN",
      },
      { ENV_HEADER: "b", TOKEN: "c" },
    ),
    { "X-Static": "a", "X-Env": "b", Authorization: "Bearer c" },
  );
  assert.equal(httpHeaders({ bearer_token_env_var: "MISSING" }, {}), null);
  assert.equal(
    httpHeaders({ http_headers_helper: { command: "x" } }, {}),
    null,
  );
});
test("timeouts are bounded", () => {
  assert.equal(timeoutMs({}), 30000);
  assert.equal(timeoutMs({ startup_timeout_sec: 1 }), 5000);
  assert.equal(timeoutMs({ startup_timeout_sec: 999 }), 120000);
});
test("http handshake maps status codes", async () => {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url} ${request.headers["x-key"]}`);
    if (request.url === "/ok") {
      response.setHeader("Mcp-Session-Id", "s1");
      response.setHeader("Content-Type", "application/json");
      response.end('{"jsonrpc":"2.0","id":1,"result":{}}');
    } else response.writeHead(request.url === "/auth" ? 401 : 503).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const check = (path: string) =>
      probeHttp({
        url: base + path,
        headers: { "X-Key": "k" },
        timeoutMs: 5000,
      });
    assert.equal((await check("/ok")).state, "connected");
    assert.equal((await check("/auth")).state, "auth-required");
    const down = await check("/down");
    assert.equal(down.state, "failed");
    assert.match(down.message, /503/);
    assert.ok(seen.includes("POST /ok k"));
  } finally {
    server.close();
  }
});
test("rows that cannot be reproduced keep the harness status", () => {
  assert.equal(probeCodex({ enabled: false, transport: {} }, null), null);
  assert.equal(
    probeCodex(
      {
        auth_status: "o_auth",
        transport: { type: "streamable_http", url: "https://x" },
      },
      null,
    ),
    null,
  );
  assert.equal(probeCodex({ transport: { type: "unknown" } }, null), null);
});
test("mapLimit preserves order and bounds concurrency", async () => {
  let active = 0;
  let peak = 0;
  const output = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (value) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });
  assert.deepEqual(output, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2);
});
