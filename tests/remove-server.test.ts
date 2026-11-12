import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { withoutServer, removeServer } from "../src/remove-server";
import { configSources } from "../src/inventory";
import type { Server } from "../src/model";
const server: Server = {
  id: "1",
  name: "docs",
  harness: "Claude Code",
  source: "/home/test/.claude.json",
  scope: "project",
  project: "/project/a",
  transport: "http",
  state: "configured",
};
test("removes only the selected Claude local scope and preserves user and other projects", () => {
  const root = {
    mcpServers: { docs: { url: "https://user.example" } },
    projects: {
      "/project/a": {
        mcpServers: {
          docs: { url: "https://a.example" },
          other: { command: "other" },
        },
      },
      "/project/b": { mcpServers: { docs: { command: "docs" } } },
    },
  };
  const result = JSON.parse(withoutServer(JSON.stringify(root), server));
  assert.ok(result.mcpServers.docs);
  assert.ok(result.projects["/project/b"].mcpServers.docs);
  assert.ok(result.projects["/project/a"].mcpServers.other);
  assert.equal(result.projects["/project/a"].mcpServers.docs, undefined);
  assert.throws(() => withoutServer("{}", server));
});
test("removes a Codex table while preserving other settings and servers", () => {
  const source =
    'model="example"\n[mcp_servers.docs]\nurl="https://docs.example"\n[mcp_servers.other]\ncommand="other"\n';
  const result = parse(
    withoutServer(source, {
      ...server,
      harness: "Codex",
      source: "/project/a/.codex/config.toml",
    }),
  );
  assert.equal(result.model, "example");
  assert.deepEqual(JSON.parse(JSON.stringify(result.mcp_servers)), {
    other: { command: "other" },
  });
});
test("removes an OpenCode server from the current mcp.servers layout and the legacy one", () => {
  const current =
    '// keep comment\n{"mcp":{"servers":{"docs":{"type":"local","command":["node"]}},"timeout":{"startup":10000}}}\n';
  const removedCurrent = withoutServer(current, {
    ...server,
    harness: "OpenCode",
    source: "/home/test/.config/opencode/opencode.jsonc",
    project: null,
    scope: "user",
  });
  assert.ok(removedCurrent.includes("// keep comment"));
  const currentRoot = JSON.parse(removedCurrent.replace(/^\/\/[^\n]*\n/, ""));
  assert.deepEqual(currentRoot.mcp.servers, {});
  assert.deepEqual(currentRoot.mcp.timeout, { startup: 10000 });

  const legacy =
    '{"mcp":{"docs":{"type":"local","command":["node"]},"keep":{"type":"local","command":["node"]}}}';
  const removedLegacy = JSON.parse(
    withoutServer(legacy, {
      ...server,
      harness: "OpenCode",
      source: "/home/test/.config/opencode/opencode.json",
      project: null,
      scope: "user",
    }),
  );
  assert.deepEqual(Object.keys(removedLegacy.mcp), ["keep"]);
});

test("creates an exact private backup and refuses symlink configurations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-remove-"));
  try {
    const source = join(directory, ".mcp.json");
    const text =
      '// keep comment\n{"mcpServers":{"docs":{"command":"docs"},"keep":{"command":"keep"}}}\n';
    await writeFile(source, text);
    await removeServer({ ...server, source });
    assert.ok((await readFile(source, "utf8")).includes("// keep comment"));
    const backup = (await readdir(directory)).find((name) =>
      name.includes(".backup-"),
    )!;
    assert.equal(await readFile(join(directory, backup), "utf8"), text);
    const link = join(directory, "link.json");
    await symlink(source, link);
    await assert.rejects(removeServer({ ...server, source: link }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("honors Claude configuration directory and Codex home overrides", () => {
  const sources = configSources("/home/test", [], {
    CLAUDE_CONFIG_DIR: "/custom/claude",
    CODEX_HOME: "/custom/codex",
  });
  assert.ok(sources.some((s) => s.path === "/custom/claude/.claude.json"));
  assert.ok(sources.some((s) => s.path === "/custom/codex/config.toml"));
});
