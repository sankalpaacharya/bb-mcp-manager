import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizationUrl, parseStatus, AuthJobs } from "../src/actions";
import type { Server } from "../src/model";
const server: Server = {
  id: "test",
  name: "docs",
  harness: "Claude Code",
  source: "/tmp/test",
  scope: "user",
  project: null,
  transport: "http",
  state: "configured",
};
test("only scoped native status proves a connection", () => {
  assert.equal(
    parseStatus(server, "Status: ✓ Connected\nsecret").state,
    "connected",
  );
  assert.equal(parseStatus(server, "Status: Disconnected").state, "failed");
  assert.equal(parseStatus(server, "Command: echo Connected").state, "unknown");
  assert.equal(
    parseStatus(server, "Status: Needs authentication").state,
    "auth-required",
  );
  assert.equal(
    parseStatus(
      { ...server, harness: "Codex" },
      JSON.stringify([
        {
          name: "docs",
          auth_status: "o_auth",
          transport: { secret: "hidden" },
        },
      ]),
    ).state,
    "credentials",
  );
  assert.equal(
    parseStatus({ ...server, harness: "Codex" }, "not json").state,
    "unknown",
  );
});
test("parses Pi's JSON status output", () => {
  const pi: Server = {
    ...server,
    harness: "Pi",
    source: "/home/u/.pi/agent/mcp.json",
  };
  const output = JSON.stringify({
    servers: [
      {
        name: "docs",
        source: "/home/u/.pi/agent/mcp.json",
        state: "connected",
      },
      { name: "other", state: "needs-auth" },
    ],
  });
  assert.equal(parseStatus(pi, output).state, "connected");
  // A project entry replaces a user-level entry, so both rows read its state.
  assert.equal(
    parseStatus({ ...pi, source: "/p/.pi/mcp.json" }, output).state,
    "connected",
  );
  assert.equal(
    parseStatus(
      pi,
      JSON.stringify({ servers: [{ name: "docs", state: "needs-auth" }] }),
    ).state,
    "auth-required",
  );
  for (const state of ["disconnected", "closed"])
    assert.equal(
      parseStatus(pi, JSON.stringify({ servers: [{ name: "docs", state }] }))
        .state,
      "failed",
    );
  assert.equal(
    parseStatus(
      pi,
      JSON.stringify({ servers: [{ name: "docs", state: "disabled" }] }),
    ).state,
    "unknown",
  );
  assert.equal(parseStatus(pi, "{}").state, "unknown");
  assert.equal(parseStatus(pi, "not json").state, "unknown");
});
test("only authorization links without credentials are returned", () => {
  const url =
    "https://example.com/authorize?client_id=sample&response_type=code";
  assert.equal(authorizationUrl("Open " + url), url);
  for (const unsafe of [
    url + "&access_token=secret",
    url + "&code=secret",
    url.replace("https://", "https://user:pass@"),
    url.replace("https:", "http:"),
  ])
    assert.equal(authorizationUrl(unsafe), null);
});
test("unsupported flows give guidance without starting a process", () => {
  const jobs = new AuthJobs();
  try {
    assert.equal(
      jobs.start({ ...server, harness: "Gemini CLI" }).command,
      "/mcp auth docs",
    );
    assert.equal(jobs.start({ ...server, transport: "stdio" }).state, "manual");
    assert.equal(
      jobs.start({ ...server, harness: "Pi", transport: "stdio" }).command,
      "'pi' 'mcp' 'login' 'docs'",
    );
    assert.equal(jobs.poll("missing").state, "failed");
  } finally {
    jobs.dispose();
  }
});

test("sign-in jobs expose only the login link, deduplicate, and cancel", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "mcp-auth-test-"));
  const originalPath = process.env.PATH;
  const jobs = new AuthJobs();
  try {
    await writeFile(
      join(directory, "claude"),
      '#!/bin/sh\necho "private-token-not-for-ui"\necho "https://example.com/authorize?client_id=test&response_type=code"\nexec sleep 30\n',
      { mode: 0o700 },
    );
    process.env.PATH = directory + ":" + originalPath;
    const started = jobs.start(server);
    assert.equal(started.state, "waiting");
    assert.ok(started.taskId);
    assert.equal(jobs.start(server).taskId, started.taskId);
    for (let i = 0; i < 100 && !jobs.poll(started.taskId!).url; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      jobs.poll(started.taskId!).url,
      "https://example.com/authorize?client_id=test&response_type=code",
    );
    assert.ok(
      !JSON.stringify(jobs.poll(started.taskId!)).includes("private-token"),
    );
    assert.equal(jobs.stop(started.taskId!).state, "failed");
    assert.equal(jobs.poll(started.taskId!).url, null);
  } finally {
    jobs.dispose();
    process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test("batch list statuses match exact names and never expose endpoint details", async () => {
  const { parseListStatus } = await import("../src/actions");
  const output =
    "docs-extra: https://secret.example - ✓ Connected\ndocs: https://secret.example - ⚠ Needs authentication\nfailed: local-command - ✗ Failed to connect";
  assert.equal(parseListStatus(server, output).state, "auth-required");
  assert.equal(
    parseListStatus({ ...server, name: "failed" }, output).state,
    "failed",
  );
  assert.equal(
    parseListStatus({ ...server, name: "missing" }, output).state,
    "unknown",
  );
  assert.ok(
    !JSON.stringify(parseListStatus(server, output)).includes("secret.example"),
  );
});
