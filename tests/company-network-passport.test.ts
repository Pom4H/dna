import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Actor, type CommandType } from "../examples/company-network/authority.ts";
import { passportFor } from "../examples/company-network/passport.ts";

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "fictional-passport-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return createStore(dir);
}

test("passport: stable simulated identity exists without invented lifecycle events", t => {
  const store = fixture(t);
  const session = store.createSession({ id: "passport-a" });
  const passport = passportFor(session);
  assert.deepEqual(passportFor(store.getSession(session.id)), passport);
  assert.deepEqual(passport.trace, []);
  assert.ok(passport.identity.instanceId.startsWith("DEMO-"));
  assert.ok(passport.identity.serial.startsWith("DEMO-"));
  assert.equal(passport.evidence, "synthetic-demo");
  assert.equal(passport.identity.identityMethod, "deterministic-session-simulation");
  assert.equal(passport.limitations.sourceAuthenticated, false);
  assert.equal(passport.limitations.physicalIdentityVerified, false);
  assert.equal(passport.limitations.replacementHistoryImplemented, false);
  assert.ok(passport.components.every(component => component.id.startsWith("DEMO-")));
  assert.deepEqual(JSON.parse(JSON.stringify(passport)), passport);
  assert.notEqual(passportFor(store.createSession({ id: "passport-b" })).identity.instanceId, passport.identity.instanceId);
});

test("passport: flags without receipts never invent an installation or acceptance", t => {
  const store = fixture(t);
  const session = store.createSession();
  const result = passportFor({ ...session, installationCompleted: true, acceptedRevision: "scope-1", subscriptionActive: true });
  assert.deepEqual(result.trace, []);
});

test("passport: lifecycle trace references only committed authority receipts and preserves identity", t => {
  const store = fixture(t);
  const session = store.createSession();
  const original = passportFor(session);
  const act = (actor: Actor, type: CommandType) => store.execute(session.id, actor, {
    type, operationKey: `passport:${type}`, expectedVersion: store.getSession(session.id).version, scopeRevision: "scope-1",
  });
  for (const [actor, type] of [["buyer", "pay-deposit"], ["supplier", "reserve-kit"], ["installer", "reserve-capacity"],
    ["installer", "complete-installation"], ["buyer", "accept-delivery"], ["supplier", "activate-subscription"]] as const) {
    assert.equal(act(actor, type).status, "committed");
  }
  const current = store.getSession(session.id);
  const passport = passportFor(current);
  assert.deepEqual(passport.identity, original.identity);
  assert.deepEqual(passport.components, original.components);
  assert.deepEqual(passport.trace.map(event => event.kind), ["order-assignment", "site-binding", "scope-acceptance", "service-activation"]);
  for (const event of passport.trace) {
    const receipt = current.receipts[event.operationKey];
    assert.ok(receipt);
    assert.equal(event.receiptId, receipt.id);
    assert.equal(event.version, receipt.version);
    assert.equal(event.scopeRevision, receipt.scopeRevision);
    assert.equal(event.at, receipt.at);
  }
  act("supplier", "activate-subscription");
  assert.deepEqual(passportFor(store.getSession(session.id)), passport);
});

test("passport: unbacked or inconsistent receipt claims are rejected", t => {
  const store = fixture(t);
  const session = store.createSession();
  store.execute(session.id, "buyer", { type: "pay-deposit", operationKey: "pay", expectedVersion: 0, scopeRevision: "scope-1" });
  const committed = store.execute(session.id, "supplier", { type: "reserve-kit", operationKey: "kit", expectedVersion: 1, scopeRevision: "scope-1" }).session;
  assert.throws(() => passportFor({ ...committed, receipts: {} }));
  const event = committed.events[1];
  assert.ok(event);
  assert.throws(() => passportFor({ ...committed, events: [...committed.events, event] }));
  assert.throws(() => passportFor({ ...committed, receipts: { ...committed.receipts, kit: { ...event, scopeRevision: "other-scope" } } }));
  assert.throws(() => passportFor({ ...session, id: "../outside" }));
});
