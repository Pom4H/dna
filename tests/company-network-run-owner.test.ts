import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRunOwner } from "../examples/company-network/run-owner.ts";

test("a completed duplicate dispatch reports the running hook owner", async () => {
  const lookup = (id: string) => ({ status: Promise.resolve(id === "dispatch" ? "completed" : "running"),
    returnValue: Promise.resolve({ duplicateOf: "owner" }) });
  assert.deepEqual(await resolveRunOwner("dispatch", lookup), { runId: "owner", status: "running" });
});

test("ordinary completion stays completed and cyclic ownership fails visibly", async () => {
  assert.deepEqual(await resolveRunOwner("owner", () => ({ status: Promise.resolve("completed"),
    returnValue: Promise.resolve({ fulfilled: true }) })), { runId: "owner", status: "completed" });
  await assert.rejects(() => resolveRunOwner("loop", () => ({ status: Promise.resolve("completed"),
    returnValue: Promise.resolve({ duplicateOf: "loop" }) })), /Cyclic/);
});
