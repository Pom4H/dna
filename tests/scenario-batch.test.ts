import { test } from "node:test";
import assert from "node:assert/strict";
import { assumption, fact, model, s, type ScenarioWriter } from "../src/index.ts";

test("batch has sequential set/record semantics, retaining conflicts and parent snapshots", () => {
  const a = fact("a", s.number()), b = fact("b", s.boolean);
  const base = model({ id: "batch", version: "1", values: [a, b] }).scenario("base");
  const next = base.batch(draft => { draft.set(a, assumption(1, "Synthetic")); draft.record(a, assumption(2, "Synthetic")); });
  assert.deepEqual(next.toJSON(), base.set(a, assumption(1, "Synthetic")).record(a, assumption(2, "Synthetic")).toJSON());
  assert.equal(next.read(a).status, "conflict");
  assert.equal(next.read(b).status, "unknown");
  assert.equal(base.read(a).status, "unknown");
});

test("batch validates every input, closes escaped writers and rolls back exceptions", () => {
  const a = fact("a", s.number({ min: 0 })), foreign = fact("foreign", s.number());
  const base = model({ id: "batch", version: "1", values: [a] }).scenario("base");
  let escaped: ScenarioWriter | undefined;
  const next = base.batch(draft => { escaped = draft; draft.set(a, assumption(1, "Synthetic")); });
  assert.throws(() => escaped?.set(a, assumption(2, "Synthetic")), /closed/);
  assert.throws(() => base.batch(draft => { draft.set(a, assumption(-1, "Invalid")); }));
  assert.throws(() => base.batch(draft => { draft.set(foreign, assumption(1, "Foreign")); }));
  assert.throws(() => base.batch(draft => { draft.set(a, assumption(9, "Synthetic")); throw new Error("stop"); }), /stop/);
  assert.throws(() => (base.batch as (callback: unknown) => unknown)(() => Promise.resolve()), /synchronous/);
  assert.equal(base.read(a).status, "unknown");
  const retained = next.read(a);
  assert.ok(retained.status === "known" && retained.value === 1);
});
