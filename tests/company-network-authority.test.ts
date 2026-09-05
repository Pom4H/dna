import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../examples/company-network/authority.ts";
import type { Actor, CommandType } from "../examples/company-network/authority.ts";

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "fictional-company-authority-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createStore(dir) };
}

test("authority: malformed commands and path traversal cannot write", t => {
  const { store } = fixture(t);
  const state = store.createSession({ id: "one" });
  assert.throws(() => store.getSession("../outside"));
  assert.throws(() => store.createSession({ id: "../outside" }));
  assert.throws(() => store.execute(state.id, "buyer", { type: "pay-deposit", operationKey: "x", expectedVersion: 0, scopeRevision: "scope-1", amount: 1 }));
  assert.throws(() => store.execute(state.id, "buyer", { type: "pay-deposit", operationKey: " ", expectedVersion: 0, scopeRevision: "scope-1" }));
  assert.throws(() => store.execute(state.id, "buyer", { type: "pay-deposit", operationKey: "x", expectedVersion: 0.5, scopeRevision: "scope-1" }));
  assert.deepEqual(store.getSession(state.id), state);
});

test("authority: wrong role and stale versions reject without effects", t => {
  const { store } = fixture(t);
  const state = store.createSession({ id: "roles" });
  const command = { type: "pay-deposit", operationKey: "deposit", expectedVersion: 0, scopeRevision: "scope-1" };
  assert.equal(store.execute(state.id, "supplier", command).reason, "wrong-actor");
  assert.equal(store.execute(state.id, "buyer", { ...command, expectedVersion: 4 }).reason, "stale-version");
  assert.equal(store.execute(state.id, "buyer", { ...command, scopeRevision: "old" }).reason, "scope-mismatch");
  assert.deepEqual(store.getSession(state.id), state);
});

test("authority: one domain key survives restart and lost acknowledgement", t => {
  const { store, dir } = fixture(t);
  const state = store.createSession({ id: "retry" });
  const command = { type: "pay-deposit", operationKey: "order-1:deposit", expectedVersion: 0, scopeRevision: "scope-1" };
  const first = store.execute(state.id, "buyer", command);
  assert.equal(first.status, "committed");
  // The caller may lose this response; a new runtime run reads the same receipt.
  const replay = createStore(dir).execute(state.id, "buyer", command);
  assert.equal(replay.status, "duplicate");
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(replay.session.buyerCashCents, 850_000);
  assert.equal(replay.session.supplierCashCents, 350_000);
  assert.equal(replay.session.events.length, 1);
  assert.equal(replay.session.version, 1);
});

test("authority: changed payload for domain key and fresh key for same effect reject", t => {
  const { store } = fixture(t);
  const state = store.createSession({ id: "keys" });
  store.execute(state.id, "buyer", { type: "pay-deposit", operationKey: "effect", expectedVersion: 0, scopeRevision: "scope-1" });
  assert.equal(store.execute(state.id, "supplier", { type: "reserve-kit", operationKey: "effect", expectedVersion: 1, scopeRevision: "scope-1" }).reason, "operation-key-conflict");
  assert.equal(store.execute(state.id, "buyer", { type: "pay-deposit", operationKey: "new-run-new-key", expectedVersion: 1, scopeRevision: "scope-1" }).reason, "already-committed");
  assert.equal(store.getSession(state.id).buyerCashCents, 850_000);
});

test("authority: missing deposit and capacity deficit are distinct explicit denials", t => {
  const { store } = fixture(t);
  const state = store.createSession({ id: "capacity", scenario: "insufficient-capacity" });
  const cmd = (type: CommandType, expectedVersion: number) => ({ type, operationKey: type, expectedVersion, scopeRevision: "scope-1" });
  assert.equal(store.execute(state.id, "supplier", cmd("reserve-kit", 0)).reason, "deposit-required");
  store.execute(state.id, "buyer", cmd("pay-deposit", 0));
  store.execute(state.id, "supplier", cmd("reserve-kit", 1));
  assert.equal(store.execute(state.id, "installer", cmd("reserve-capacity", 2)).reason, "insufficient-capacity");
  const repair = store.execute(state.id, "installer", cmd("repair-capacity", 2));
  assert.equal(repair.session.installerAvailableHours, 8);
  assert.equal(store.execute(state.id, "installer", cmd("reserve-capacity", 3)).status, "committed");
  assert.equal(store.getSession(state.id).installerAvailableHours, 2);
});

test("authority: competing callers cannot consume the last kit twice", t => {
  const { store } = fixture(t);
  const state = store.createSession({ id: "race" });
  store.execute(state.id, "buyer", { type: "pay-deposit", operationKey: "pay", expectedVersion: 0, scopeRevision: "scope-1" });
  const first = store.execute(state.id, "supplier", { type: "reserve-kit", operationKey: "run-a", expectedVersion: 1, scopeRevision: "scope-1" });
  const second = store.execute(state.id, "supplier", { type: "reserve-kit", operationKey: "run-b", expectedVersion: 1, scopeRevision: "scope-1" });
  assert.equal(first.status, "committed");
  assert.equal(second.reason, "stale-version");
  assert.equal(store.getSession(state.id).stockKits, 0);
  assert.equal(store.getSession(state.id).supplierCashCents, 260_000);
});

test("authority: activation needs scoped buyer acceptance; physical work pays installer once", t => {
  const { store } = fixture(t);
  const state = store.createSession({ id: "full" });
  const act = (actor: Actor, type: CommandType) => store.execute(state.id, actor, { type, operationKey: `full:${type}`, expectedVersion: store.getSession(state.id).version, scopeRevision: "scope-1" });
  assert.equal(act("supplier", "activate-subscription").reason, "acceptance-required");
  assert.equal(act("buyer", "accept-delivery").reason, "installation-required");
  for (const [actor, type] of [["buyer", "pay-deposit"], ["supplier", "reserve-kit"], ["installer", "reserve-capacity"], ["installer", "complete-installation"]] as const) assert.equal(act(actor, type).status, "committed");
  assert.equal(store.getSession(state.id).installerCashCents, 60_000);
  assert.equal(store.getSession(state.id).supplierCashCents, 200_000);
  assert.equal(act("supplier", "activate-subscription").reason, "acceptance-required");
  assert.equal(act("buyer", "accept-delivery").status, "committed");
  assert.equal(act("supplier", "activate-subscription").status, "committed");
  assert.equal(act("supplier", "activate-subscription").status, "duplicate");
  const final = store.getSession(state.id);
  assert.equal(final.subscriptionActive, true);
  assert.equal(final.acceptedRevision, "scope-1");
  assert.equal(final.installerAvailableHours, 2);
  assert.equal(final.events.length, 6);
  assert.deepEqual(final.terms, state.terms);
  assert.equal(final.terms.agreementAnnualSaasCents, 180_000);
});

test("authority: isolated sessions and projections cannot edit stored terms", t => {
  const { store } = fixture(t);
  const a = store.createSession({ id: "a" });
  const b = store.createSession({ id: "b" });
  assert.throws(() => store.createSession({ id: "a" }));
  const copy = JSON.parse(JSON.stringify(a));
  copy.terms.depositCents = 1;
  assert.equal(store.getSession("a").terms.depositCents, 150_000);
  assert.deepEqual(store.getSession("b"), b);
  assert.equal(store.listSessions().length, 2);
});

test("authority: corrupt or modified persistent state fails closed", t => {
  const { store, dir } = fixture(t);
  store.createSession({ id: "corrupt" });
  const file = readdirSync(dir).find(name => name.endsWith(".json"));
  assert.ok(file);
  const path = join(dir, file);
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.terms.depositCents = 1;
  writeFileSync(path, JSON.stringify(state));
  assert.throws(() => store.getSession("corrupt"));
});

test("authority: valid operation keys cannot collide with Object prototype properties", t => {
  const { store } = fixture(t);
  for (const key of ["toString", "constructor", "__proto__"]) {
    const state = store.createSession();
    const command = { type: "pay-deposit", operationKey: key, expectedVersion: 0, scopeRevision: "scope-1" };
    assert.equal(store.execute(state.id, "buyer", command).status, "committed");
    assert.equal(store.execute(state.id, "buyer", command).status, "duplicate");
    assert.equal(store.getSession(state.id).buyerCashCents, 850_000);
  }
});
