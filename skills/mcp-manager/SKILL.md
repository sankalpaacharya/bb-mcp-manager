---
name: mcp-manager
description: Inspect configured MCP servers across Claude Code, Codex, Gemini CLI, OpenCode, and Cursor using the MCP Manager BB plugin.
---

Run `bb mcp-manager list --json` for inventory metadata, or `bb mcp-manager list` for readable output. The MCP inventory sidebar page provides harness logo/count filters, a plain connection list, and Refresh.

The plugin scans the primary enrolled host by default. Its `hostId` setting selects another enrolled host; `projectPaths` lists up to 20 absolute folders on that host, separated by newlines. Configure these through MCP Manager settings or `bb plugin config mcp-manager`.

Report entries as configured, disabled in configuration, or incomplete. The CLI inventory does not check live status. The UI checks status in the background at BB startup and on explicit refresh, and offers Re-authenticate per row and a page-level Refresh. Claude and Pi report live status. Codex servers are verified by MCP Manager with an MCP initialize handshake using the launch settings Codex resolves; Codex OAuth servers keep the saved-credential status. Other harnesses direct users to native status checks. Browser sign-in uses supported Claude, Codex, or OpenCode CLI commands; Gemini and Cursor provide manual guidance. Local process credentials remain harness-managed. Preserve source and project scope when reporting duplicate names. Read errors mean coverage is incomplete; missing source files are normal.

Only named configuration files are scanned. Plugin-bundled MCPs, cloud connectors, managed settings, runtime overrides, and parent-directory inheritance are outside this version's coverage. Commands, arguments, URLs, and credentials are excluded from output. Inventory scans never execute servers or edit harness configuration; only status checks start servers.

Opening the page only reads cached inventory and status. Pending background results are polled without launching new CLI checks. The cache lasts until BB restarts or the plugin reloads; Refresh rescans with current settings.

Status refresh runs one native list command per harness/project context, sharing the result across its servers. Claude uses `claude mcp list`; Codex uses `codex mcp list --json`, then briefly starts each enabled Codex server (up to four at once) to confirm it answers. Configuration is displayed before health checks finish; unreachable servers can still delay a harness response.

The row trash action removes only the selected source declaration after confirmation, with a private backup beside the file. It does not revoke OAuth tokens. Codex TOML is reserialized; JSONC edits preserve surrounding comments. Claude scans respect CLAUDE_CONFIG_DIR. Reconnect uses the host system browser; Linux provides a TTY through util-linux script.

The UI combines identical names within a harness and counts those rows. Select a configuration for scoped reconnect/delete; grouping does not imply matching endpoints.
