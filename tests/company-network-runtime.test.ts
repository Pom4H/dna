import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../examples/company-network/authority.ts";
import { evaluationFromSession } from "../examples/company-network/runtime-state.ts";
import { projectCompanyUI } from "../examples/company-network/ui-ir.ts";

test("runtime: evaluation and UI keep the captured authority snapshot across an asynchronous gap", async t => {
  const directory = mkdtempSync(join(tmpdir(), "fictional-network-snapshot-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const captured = store.createSession({ id: "captured-before-payment" });
  const original = JSON.stringify(captured);

  // Represents a commit while the HTTP view awaits SDK workflow statuses.
  await Promise.resolve().then(() => {
    assert.equal(store.execute(captured.id, "buyer", { type: "pay-deposit", operationKey: "deposit",
      expectedVersion: captured.version, scopeRevision: captured.scopeRevision }).status, "committed");
  });
  const live = store.getSession(captured.id);
  assert.equal(live.version, captured.version + 1);
  assert.equal(live.depositReceived, true);

  const assessment = evaluationFromSession(captured);
  const ui = projectCompanyUI(captured, assessment);
  assert.equal(assessment.decisions.procurement.status, "fail");
  assert.equal(ui.relations.find(relation => relation.id === "deposit")?.state, "pending");
  assert.equal(ui.subjects.find(subject => subject.id === "buyer")?.metrics.find(metric => metric.id === "deposit")?.value, "Не отправлен");
  const cash = assessment.report.values.find(value => value.id === "network.state.buyerCashCents");
  assert.equal(cash?.status, "known");
  if (cash?.status === "known") assert.equal(cash.value, captured.buyerCashCents);
  assert.equal(evaluationFromSession(live).decisions.procurement.status, "pass");
  assert.equal(JSON.stringify(captured), original);
});

test("runtime: captured session evaluation does not need an authority directory", t => {
  const directory = mkdtempSync(join(tmpdir(), "fictional-network-detached-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const captured = createStore(directory).createSession({ id: "detached" });
  const before = evaluationFromSession(captured);
  rmSync(directory, { recursive: true, force: true });
  assert.deepEqual(evaluationFromSession(captured), before);
});
