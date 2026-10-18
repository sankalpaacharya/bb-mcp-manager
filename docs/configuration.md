# Configuration and status

## Status

Checks run at plugin startup and when you click Refresh. Opening the page uses cached results.

Claude Code reports connection status. Codex reports whether credentials are saved, which does not prove the server is reachable. Pi reports live status by connecting to every enabled server. Live status for the other harnesses must be checked in the harness itself. Counts show configured connections, including disabled ones.

Reconnect support depends on the harness and server. The harness CLI must be on the host’s PATH; Linux browser sign-in also needs util-linux `script`. If a browser flow is unavailable, the row shows instructions.

## Configuration files

| Harness     | User                                           | Project                     |
| ----------- | ---------------------------------------------- | --------------------------- |
| Claude Code | `~/.claude.json`, including project entries    | `.mcp.json`                 |
| Codex       | `~/.codex/config.toml`                         | `.codex/config.toml`        |
| Gemini CLI  | `~/.gemini/settings.json`                      | `.gemini/settings.json`     |
| OpenCode    | `~/.config/opencode/opencode.json` or `.jsonc` | `opencode.json` or `.jsonc` |
| Cursor      | `~/.cursor/mcp.json`                           | `.cursor/mcp.json`          |
| Pi          | `~/.pi/agent/mcp.json`                         | `.pi/mcp.json`              |

The plugin respects `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_CONFIG_HOME`, and an absolute `OPENCODE_CONFIG` path from the BB host worker’s environment.

Only these files and explicitly listed project folders are scanned. Plugin-bundled servers, cloud connectors, managed settings, and runtime overrides are not included. Scans are limited to 20 project folders, 1 MiB per file, and 250 entries.

Commands, URLs, headers, and credentials are not included in inventory output. Status checks and sign-in run the native harness CLI, which may launch MCP processes or save credentials. Deleting a connection does not revoke credentials; for Pi, `pi mcp logout <server>` deletes stored OAuth tokens. JSON edits preserve comments; editing Codex TOML may change formatting and remove comments.

Pi loads project configuration only in trusted projects. An untrusted project's `.pi/mcp.json` is still listed and scanned, but `pi` does not report or connect those servers until the project is trusted. Pi override entries, which only set `enabled`, `exposure`, or `toolExposure` for a user-level server, appear as configurations on the merged row.

Tags are stored in BB, separately from harness configuration. A tag change on a combined row applies to all its existing configurations.

See [icon sources](../assets/ICON-SOURCES.md) for logo attribution.
