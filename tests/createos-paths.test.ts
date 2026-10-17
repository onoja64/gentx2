import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorkspaceDirectory } from "../lib/createos/paths";

test("sandbox command paths allow the workspace root and its descendants only", () => {
  assert.equal(isWorkspaceDirectory("/workspace"), true);
  assert.equal(isWorkspaceDirectory("/workspace/target"), true);
  assert.equal(isWorkspaceDirectory("/workspace/target/src"), true);
  assert.equal(isWorkspaceDirectory("/workspace/../etc"), false);
  assert.equal(isWorkspaceDirectory("/workspace-elsewhere"), false);
  assert.equal(isWorkspaceDirectory("/opt/gentx2"), false);
});
