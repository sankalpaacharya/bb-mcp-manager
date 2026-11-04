import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeConnections, type Server } from "../src/model";
const server: Server = {
  id: "1",
  name: "docs",
  harness: "Codex",
  source: "/config",
  project: null,
  scope: "user",
  transport: "http",
  state: "disabled",
};
test("same names merge within a harness but not across harnesses", () => {
  const other = { ...server, id: "2", project: "/other" };
  assert.equal(mergeConnections([server, other]).length, 1);
  assert.equal(
    mergeConnections([server, { ...other, harness: "Claude Code" }]).length,
    2,
  );
});
