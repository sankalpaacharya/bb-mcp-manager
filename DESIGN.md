# MCP connections

Use BB's existing font and semantic theme tokens. A compact heading precedes a single compact summary bar with harness logos and unique-name counts. Selecting a harness filters a plain list below it.

Each row contains the server name, scope, harness, status, and compact Reconnect and delete controls. Sign-in instructions appear inline when needed. No internal sidebar, server cards, dashboard statistics, inspector, decorative palette, or remote fonts. Same names within a harness share a row. Their underlying configurations remain separate and a selector requires choosing a scope before reconnecting or deleting.

Status checks run in the background at BB plugin startup and on explicit refresh, with all harness/project batches running concurrently. Saved credentials do not imply a live connection. Disabled or incomplete entries retain their labels and disable actions. Counts include those entries.

Rows wrap on narrow panels. Controls support keyboard focus and selected states. All logos are bundled locally; attribution is in assets/ICON-SOURCES.md.

Opening the page only reads cached inventory and status. Pending background results are polled without launching new CLI checks. The cache lasts until BB restarts or the plugin reloads; Refresh rescans with current settings.

Status refresh runs one native list command per harness/project context, sharing the result across its servers. Claude uses `claude mcp list`; Codex uses `codex mcp list --json`. Configuration is displayed before health checks finish; unreachable servers can still delay a harness response.

Search composes with the harness filter without a network request.

Unknown services use a neutral connector symbol rather than colored initials.

## Visual refinement

This is a native IDE utility: inherit BB font and semantic background, foreground, muted, border, and focus tokens. No independent hex palette or display typeface. Use 18px headings, 13px names, 12px secondary labels, and 11px counts. Harnesses use an understated underline for selection, with brand color confined to logos. Service logos sit directly on the row, without tiles. Share the column definition between headings and rows; rows are approximately 44px high on desktop and become two lines below 640px. Search and filters share one toolbar. Avoid cards and extra dashboard summaries.
