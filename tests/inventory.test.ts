import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { scanInventory } from "../src/inventory";

async function fixture(
  run: (
    home: string,
    put: (path: string, content: string) => Promise<void>,
  ) => Promise<void>,
) {
  const home = await mkdtemp(join(tmpdir(), "mcp-inventory-"));
  try {
    await run(home, async (path, content) => {
      const file = join(home, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("reads six harness formats and excludes launch details and credentials", async () =>
  fixture(async (home, put) => {
    await put(
      ".claude.json",
      JSON.stringify({
        mcpServers: {
          docs: {
            command: "SECRET_COMMAND",
            args: ["SECRET_ARG"],
            env: { TOKEN: "SECRET_ENV" },
          },
        },
        projects: {
          [join(home, "project")]: {
            mcpServers: {
              local: {
                type: "http",
                url: "https://SECRET_URL",
                headers: { Authorization: "SECRET_HEADER" },
              },
            },
          },
        },
      }),
    );
    await put(
      ".codex/config.toml",
      '[mcp_servers.docs]\nurl = "https://SECRET_CODEX"\nenabled = false\n',
    );
    await put(
      ".gemini/settings.json",
      '{"mcpServers":{"gemini":{"httpUrl":"https://SECRET_GEMINI"}}}',
    );
    await put(
      ".cursor/mcp.json",
      '{"mcpServers":{"cursor":{"command":"node"}}}',
    );
    await put(
      ".config/opencode/opencode.jsonc",
      '{// comment\n"mcp":{"open":{"type":"local","command":["node","SECRET_SCRIPT"],},},}',
    );
    await put(
      ".pi/agent/mcp.json",
      JSON.stringify({
        mcpServers: {
          remote: {
            url: "https://SECRET_PI",
            headers: { Authorization: "SECRET_PI_AUTH" },
          },
          off: { command: "node", enabled: false },
        },
      }),
    );
    const result = await scanInventory({ home, env: {} });
    assert.equal(result.servers.length, 8);
    assert.equal(new Set(result.servers.map((s) => s.harness)).size, 6);
    assert.equal(
      result.servers.find((s) => s.harness === "Codex")?.state,
      "disabled",
    );
    assert.equal(
      result.servers.find((s) => s.harness === "Pi" && s.name === "off")?.state,
      "disabled",
    );
    assert.equal(
      result.servers.find((s) => s.name === "local")?.project,
      join(home, "project"),
    );
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }));

test("reports malformed files without leaking parser snippets and keeps other sources", async () =>
  fixture(async (home, put) => {
    await put(".codex/config.toml", '[mcp_servers]\ntoken = "SECRET_BAD');
    await put(
      ".cursor/mcp.json",
      '{"mcpServers":{"ok":{"command":"node"},"bad":null}}',
    );
    const result = await scanInventory({ home, env: {} });
    assert.equal(result.servers.length, 2);
    assert.equal(
      result.servers.find((s) => s.name === "bad")?.state,
      "invalid",
    );
    assert.equal(result.sources.filter((s) => s.status === "error").length, 1);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_BAD/);
  }));

test("treats Pi override entries as valid and marks rejected SSE as invalid", async () =>
  fixture(async (home, put) => {
    await put(
      ".pi/agent/mcp.json",
      '{"mcpServers":{"docs":{"url":"https://example.com/mcp"}}}',
    );
    await put(
      "project/.pi/mcp.json",
      '{"mcpServers":{"docs":{"enabled":true,"exposure":"direct"},"legacy":{"type":"sse","url":"https://example.com/sse"}}}',
    );
    const result = await scanInventory({
      home,
      env: {},
      projects: [join(home, "project")],
    });
    const override = result.servers.find(
      (s) => s.harness === "Pi" && s.name === "docs" && s.scope === "project",
    );
    assert.equal(override?.state, "configured");
    assert.equal(override?.transport, "unknown");
    assert.equal(
      result.servers.find((s) => s.harness === "Pi" && s.name === "legacy")
        ?.state,
      "invalid",
    );
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }));

test("preserves same-name project and user entries without inventing effective precedence", async () =>
  fixture(async (home, put) => {
    const config = '{"mcpServers":{"docs":{"command":"node"}}}';
    await put(".cursor/mcp.json", config);
    await put("project/.cursor/mcp.json", config);
    const result = await scanInventory({
      home,
      env: {},
      projects: [join(home, "project"), join(home, "project")],
    });
    assert.equal(result.servers.length, 2);
    assert.equal(new Set(result.servers.map((s) => s.id)).size, 2);
    assert.deepEqual(
      result.servers.map((s) => s.scope),
      ["user", "project"],
    );
  }));

test("bounds files and result size", async () =>
  fixture(async (home, put) => {
    await put(".claude.json", " ".repeat(1024 * 1024 + 1));
    await put(
      ".cursor/mcp.json",
      JSON.stringify({
        mcpServers: Object.fromEntries(
          Array.from({ length: 300 }, (_, i) => [
            `server-${i}`,
            { command: "node" },
          ]),
        ),
      }),
    );
    const result = await scanInventory({ home, env: {} });
    assert.equal(result.servers.length, 250);
    assert.equal(result.truncated, true);
    assert.equal(
      result.sources.find((s) => s.harness === "Claude Code")?.status,
      "error",
    );
  }));

test("honors Codex and OpenCode directory overrides", async () =>
  fixture(async (home, put) => {
    await put("custom/config.toml", '[mcp_servers.override]\ncommand = "node"');
    await put(
      "xdg/opencode/opencode.json",
      '{"mcp":{"xdg":{"command":["node"]}}}',
    );
    const result = await scanInventory({
      home,
      env: {
        CODEX_HOME: join(home, "custom"),
        XDG_CONFIG_HOME: join(home, "xdg"),
      },
    });
    assert.deepEqual(
      result.servers.map((s) => s.name),
      ["override", "xdg"],
    );
  }));

test("rejects relative project paths and observes cancellation", async () => {
  await assert.rejects(scanInventory({ projects: ["relative"] }), /absolute/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scanInventory({ signal: controller.signal }), {
    name: "AbortError",
  });
});
