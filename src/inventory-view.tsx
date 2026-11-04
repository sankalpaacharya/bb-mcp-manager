import { TagPicker } from "./tag-picker";
import { useEffect, useId, useState } from "react";
import { HARNESSES, type Harness, type Inventory, type Server } from "./model";
import type { ActionResult } from "./actions";
import type { ConnectionCheck } from "./status-cache";
import { ServerIcon } from "./server-icon";
import { groupByTag, mergeConnections, type Tags } from "./tags";
import { HarnessIcon } from "./harness-icons";

export interface Actions {
  saveTags?: (id: string, tags: string[]) => Promise<void>;
  remove?: (id: string) => Promise<void>;
  authenticate: (id: string) => Promise<ActionResult>;
  check?: (id: string) => Promise<void>;
  poll: (id: string) => Promise<ActionResult>;
  cancel: (id: string) => Promise<ActionResult>;
}
function ServerRow({
  server,
  actions,
  hidden,
  connection,
  suggestions,
  tags = [],
  variants = [],
  selectedId,
  onSelect,
}: {
  server: Server;
  actions?: Actions;
  hidden: boolean;
  connection?: ConnectionCheck;
  suggestions: string[];
  tags?: string[];
  variants?: Server[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const status = connection?.result;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [auth, setAuth] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!actions || auth?.state !== "waiting" || !auth.taskId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await actions.poll(auth.taskId!);
        if (!stopped) {
          setAuth(next);
          if (next.state === "waiting") timer = setTimeout(poll, 2000);
          else if (next.state === "complete")
            void actions.check?.(server.id).catch(() => {});
        }
      } catch {
        if (!stopped) {
          setError("Could not check sign-in progress.");
          timer = setTimeout(poll, 5000);
        }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [actions?.poll, actions?.check, server.id, auth?.taskId, auth?.state]);
  const run = async () => {
    if (!actions) return;
    setBusy(true);
    setError(null);
    try {
      setAuth(
        auth?.state === "waiting" && auth.taskId
          ? await actions.cancel(auth.taskId)
          : await actions.authenticate(server.id),
      );
    } catch {
      setError("Action failed. Check your host connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!actions?.remove) return;
    setBusy(true);
    setError(null);
    try {
      await actions.remove(server.id);
      setConfirmDelete(false);
    } catch {
      setError("Could not remove this connection. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  };
  const needsScope = variants.length > 1 && !selectedId;
  const unavailable = server.state !== "configured" || !actions || needsScope;
  return (
    <li
      className="mcp-row"
      data-expanded={expanded}
      hidden={hidden}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("button, select, input, a, [data-row-details]"))
          setExpanded((value) => !value);
      }}
    >
      <div className="mcp-identity">
        <div className="mcp-name">
          <button
            className="mcp-row-toggle"
            aria-label={`Details for ${server.name}`}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded(!expanded)}
          >
            <svg
              className="mcp-chevron"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d={expanded ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} />
            </svg>
            <ServerIcon name={server.name} />
            <strong>{server.name}</strong>
          </button>
          {variants.length > 1 && (
            <select
              className="mcp-scope-select"
              aria-label={`Configuration for ${server.name}`}
              value={selectedId ?? ""}
              onChange={(event) => onSelect?.(event.target.value)}
            >
              <option value="">{variants.length} configurations</option>
              {variants.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.project ?? "User-wide"} ·{" "}
                  {entry.source.endsWith("/.mcp.json") ? "shared" : "private"}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <span className="mcp-row-harness">
        <HarnessIcon harness={server.harness} />
        {server.harness}
      </span>
      <span className="mcp-status" role="status">
        <span
          aria-hidden="true"
          className={
            connection?.pending && server.state === "configured"
              ? "mcp-spinner"
              : `mcp-status-dot mcp-status-${status?.state ?? "unknown"}`
          }
        />
        {server.state === "disabled"
          ? "Disabled"
          : server.state === "invalid"
            ? "Incomplete"
            : connection?.pending
              ? "Checking…"
              : needsScope
                ? "Select configuration"
                : !status
                  ? "Not checked"
                  : status.state === "connected"
                    ? "Connected"
                    : status.state === "credentials"
                      ? "Credentials saved"
                      : status.state === "auth-required"
                        ? "Sign-in required"
                        : status.state === "failed"
                          ? "Not connected"
                          : "Status unavailable"}
      </span>
      <div className="mcp-actions">
        <button disabled={unavailable || busy} onClick={() => void run()}>
          {busy
            ? "Starting…"
            : auth?.state === "waiting"
              ? "Cancel sign-in"
              : "Reconnect"}
        </button>
        <button
          className="mcp-delete"
          aria-label={`Delete ${server.name}`}
          disabled={
            !actions?.remove || busy || needsScope || auth?.state === "waiting"
          }
          onClick={() => setConfirmDelete(true)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
          </svg>
        </button>
      </div>
      <div
        id={detailsId}
        className="mcp-row-details"
        data-row-details
        hidden={!expanded}
      >
        {expanded && (
          <>
            <div className="mcp-detail-tags">
              {tags.length ? (
                tags.map((tag) => (
                  <span className="mcp-detail-tag" key={tag}>
                    {tag}
                  </span>
                ))
              ) : (
                <span className="mcp-detail-label">No tags yet</span>
              )}
              <TagPicker
                name={server.name}
                tags={tags}
                suggestions={suggestions}
                onSave={
                  actions?.saveTags
                    ? (values) => actions.saveTags!(server.id, values)
                    : undefined
                }
              />
            </div>
          </>
        )}
      </div>
      {confirmDelete && (
        <div
          className="mcp-message"
          role="group"
          aria-label={`Confirm deletion of ${server.name}`}
        >
          <span>
            Remove {server.name} from {server.harness}? A backup will be saved.
            <code>
              {server.source}
              {server.project ? ` · ${server.project}` : ""}
            </code>
          </span>
          <button disabled={busy} onClick={() => void remove()}>
            Delete connection
          </button>
          <button disabled={busy} onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      )}
      {(error || auth) && (
        <div className="mcp-message" role="status">
          {error ?? auth?.message}
          {auth?.command && auth.state === "manual" && (
            <code>{auth.command}</code>
          )}{" "}
        </div>
      )}
    </li>
  );
}
function ConnectionRow({
  suggestions,
  variants,
  checks,
  tags,
  actions,
}: {
  suggestions: string[];
  variants: Server[];
  checks?: Record<string, ConnectionCheck>;
  tags: string[];
  actions?: Actions;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selected = variants.find((entry) => entry.id === selectedId);
  const server = selected ?? variants[0];
  const rowActions = actions
    ? {
        ...actions,
        saveTags: actions.saveTags
          ? async (_id: string, values: string[]) => {
              await Promise.all(
                variants.map((entry) => actions.saveTags!(entry.id, values)),
              );
            }
          : undefined,
      }
    : undefined;
  return (
    <ServerRow
      key={server.id}
      server={server}
      connection={checks?.[server.id]}
      variants={variants}
      selectedId={selected?.id}
      onSelect={setSelectedId}
      actions={rowActions}
      tags={tags}
      suggestions={suggestions}
      hidden={false}
    />
  );
}
export function InventoryView({
  inventory,
  pending,
  error,
  onRefresh,
  actions,
  cachedChecks,
  tags = {},
}: {
  tags?: Tags;
  cachedChecks?: Record<string, ConnectionCheck>;
  inventory: Inventory | null;
  pending: boolean;
  error: string | null;
  onRefresh: () => void;
  actions?: Actions;
}) {
  const [harness, setHarness] = useState<Harness | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const variants = mergeConnections(inventory?.servers ?? []);
  const entries = variants.map((group) => group[0]);
  const combinedTags: Tags = Object.fromEntries(
    variants.map((group) => [
      group[0].id,
      [...new Set(group.flatMap((entry) => tags[entry.id] ?? []))].sort(),
    ]),
  );
  const matching = entries.filter(
    (entry) =>
      [entry.name, entry.harness, ...(combinedTags[entry.id] ?? [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()) &&
      (!harness || entry.harness === harness),
  );
  const visible = matching.filter(
    (entry) =>
      tagFilter === "all" ||
      (tagFilter === "untagged" && !combinedTags[entry.id]?.length) ||
      combinedTags[entry.id]?.includes(tagFilter.slice(4)),
  );
  const tagNames = [...new Set(Object.values(tags).flat())].sort();
  const sorted = [...visible].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.harness.localeCompare(b.harness),
  );
  const groups = grouped
    ? groupByTag(sorted, combinedTags)
    : [{ name: null, servers: sorted }];
  const issues =
    inventory?.sources.filter((source) => source.status === "error") ?? [];
  return (
    <div className="mcp-simple">
      <main>
        <header>
          <h1>
            MCP connections <span>{inventory ? entries.length : "—"}</span>
          </h1>
          <button
            className="mcp-refresh"
            onClick={onRefresh}
            disabled={pending}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
            </svg>
            {pending ? "Refreshing…" : "Refresh"}
          </button>
        </header>
        <nav className="mcp-harnesses" aria-label="Filter by harness">
          <button
            aria-pressed={harness === null}
            onClick={() => setHarness(null)}
          >
            <span className="mcp-harness-label">All harnesses</span>
            <span className="mcp-count">
              {inventory ? entries.length : "—"}
            </span>
          </button>
          {HARNESSES.map((name) => (
            <button
              key={name}
              aria-pressed={harness === name}
              onClick={() => setHarness(harness === name ? null : name)}
            >
              <span className="mcp-harness-label">
                <HarnessIcon harness={name} />
                <span>{name}</span>
              </span>
              <span className="mcp-count">
                {inventory
                  ? entries.filter((entry) => entry.harness === name).length
                  : "—"}
              </span>
            </button>
          ))}
        </nav>
        <div className="mcp-tag-toolbar">
          <div className="mcp-search-field">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 5 5" />
            </svg>
            <input
              className="mcp-search"
              type="search"
              aria-label="Search MCP connections"
              placeholder="Search connections…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="Filter by tag"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="all">All tags</option>
            {tagNames.map((tag) => (
              <option key={tag} value={`tag:${tag}`}>
                {tag} (
                {
                  matching.filter((entry) =>
                    combinedTags[entry.id]?.includes(tag),
                  ).length
                }
                )
              </option>
            ))}
            <option value="untagged">
              Untagged (
              {
                matching.filter((entry) => !combinedTags[entry.id]?.length)
                  .length
              }
              )
            </option>
          </select>
          <label className="mcp-group-toggle">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(event) => setGrouped(event.target.checked)}
            />
            Group by tag
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <section aria-label="MCP servers" aria-busy={pending}>
          {!inventory ? (
            <p className="mcp-empty">
              {pending
                ? "Reading configurations…"
                : "Unable to load connections."}
            </p>
          ) : (
            <>
              <div className="mcp-list-heading" aria-hidden="true">
                <span>Connector</span>
                <span>Harness</span>
                <span>Status</span>
                <span />
              </div>
              {groups.map((group) => (
                <div key={grouped ? JSON.stringify(group.name) : "all"}>
                  {grouped && (
                    <h2 className="mcp-group-heading">
                      {group.name ?? "Untagged"}{" "}
                      <span>{group.servers.length}</span>
                    </h2>
                  )}
                  <ul className="mcp-list">
                    {group.servers.map((server) => (
                      <ConnectionRow
                        key={server.id}
                        variants={variants.find(
                          (group) => group[0].id === server.id,
                        )!}
                        suggestions={tagNames}
                        tags={combinedTags[server.id] ?? []}
                        checks={cachedChecks}
                        actions={actions}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              {!visible.length && (
                <p className="mcp-empty">
                  {entries.length
                    ? "No connections match these filters."
                    : "No MCP connections found. Add project folders in settings to include project configurations."}
                </p>
              )}
            </>
          )}
        </section>
        {!!issues.length && (
          <p className="mcp-note" role="status">
            {issues.length} configuration{" "}
            {issues.length === 1 ? "file could" : "files could"} not be read.
            Check host settings and file access.
          </p>
        )}
        {inventory?.truncated && (
          <p className="mcp-note">Showing the first 250 configurations.</p>
        )}
        <footer>
          Counts show unique names per harness, including disabled MCPs.{" "}
          {grouped
            ? "Connections with multiple tags appear in each group."
            : "Status is cached from background checks."}
        </footer>
      </main>
    </div>
  );
}
