import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { InventoryView } from "../src/inventory-view";
import type { Inventory } from "../src/model";

test("plain list filters by harness and offers re-authentication", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  const { render, fireEvent, cleanup, within, waitFor } =
    await import("@testing-library/react");
  const data: Inventory = {
    scannedAt: "2026-09-23T00:00:00Z",
    truncated: false,
    servers: [
      {
        id: "1",
        name: "docs",
        harness: "Codex",
        source: "/home/test/.codex/config.toml",
        scope: "user",
        project: null,
        transport: "http",
        state: "configured",
      },
      {
        id: "2",
        name: "design",
        harness: "Cursor",
        source: "/home/test/.cursor/mcp.json",
        scope: "user",
        project: null,
        transport: "stdio",
        state: "disabled",
      },
    ],
    sources: [
      {
        harness: "Gemini CLI",
        path: "/home/test/.gemini/settings.json",
        project: null,
        scope: "user",
        status: "error",
        issue: "Could not read or parse this configuration.",
      },
    ],
  };
  let refreshed = 0;
  let removed = 0;
  try {
    const view = render(
      <InventoryView
        actions={{
          remove: async () => {
            removed++;
          },
          authenticate: async () => ({
            state: "waiting",
            message: "Sample sign-in ready",
            taskId: null,
            url: "https://example.com/authorize?client_id=test&response_type=code",
            command: null,
          }),
          poll: async () => {
            throw new Error("unexpected poll");
          },
          cancel: async () => {
            throw new Error("unexpected cancel");
          },
        }}
        inventory={data}
        pending={false}
        error={null}
        onRefresh={() => {
          refreshed++;
        }}
      />,
    );
    const servers = () =>
      within(view.getByRole("region", { name: "MCP servers" }));
    assert.equal(servers().getAllByRole("listitem").length, 2);
    const search = view.getByRole("searchbox", {
      name: "Search MCP connections",
    });
    fireEvent.change(search, { target: { value: "DOC" } });
    assert.equal(servers().getAllByRole("listitem").length, 1);
    fireEvent.change(search, { target: { value: "no-match" } });
    assert.ok(servers().getByText("No connections match these filters."));
    fireEvent.change(search, { target: { value: "" } });
    const row = within(servers().getByText("docs").closest("li")!);
    assert.equal(row.getAllByRole("button").length, 2);
    assert.ok(row.getByText("Not checked"));
    assert.ok(!view.queryByRole("button", { name: "Check status" }));
    fireEvent.click(row.getByRole("button", { name: "Delete docs" }));
    assert.equal(removed, 0);
    fireEvent.click(row.getByRole("button", { name: "Cancel" }));
    assert.equal(removed, 0);
    fireEvent.click(row.getByRole("button", { name: "Delete docs" }));
    fireEvent.click(row.getByRole("button", { name: "Delete connection" }));
    await waitFor(() => assert.equal(removed, 1));
    await waitFor(() =>
      assert.ok(!row.queryByRole("button", { name: "Delete connection" })),
    );
    fireEvent.click(row.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => assert.ok(row.getByText("Sample sign-in ready")));
    assert.ok(!view.queryByRole("link", { name: /Open sign-in/ }));
    fireEvent.click(view.getByRole("button", { name: /^Codex/ }));
    assert.equal(servers().getAllByRole("listitem").length, 1);
    fireEvent.click(view.getByRole("button", { name: /^All / }));
    assert.equal(servers().getAllByRole("listitem").length, 2);
    assert.ok(
      within(servers().getByText("design").closest("li")!)
        .getByRole("button", { name: "Reconnect" })
        .hasAttribute("disabled"),
    );
    fireEvent.click(view.getByRole("button", { name: "Refresh" }));
    assert.equal(refreshed, 1);
    const merged = {
      ...data,
      servers: [
        ...data.servers,
        { ...data.servers[0], id: "3", project: "/work/other" },
      ],
    };
    view.rerender(
      <InventoryView
        inventory={merged}
        pending={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    assert.equal(
      servers().getAllByRole("listitem").length,
      2,
      "same-name projects share a row",
    );
    assert.ok(view.getByRole("combobox", { name: "Configuration for docs" }));
    view.rerender(
      <InventoryView
        inventory={data}
        pending={true}
        error={null}
        onRefresh={() => {}}
      />,
    );
    assert.ok(
      view
        .getByRole("button", { name: "Refreshing…" })
        .hasAttribute("disabled"),
    );
  } finally {
    cleanup();
    dom.window.close();
  }
});
