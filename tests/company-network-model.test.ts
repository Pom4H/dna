import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineInput, evaluateBusiness } from "../examples/company-network/model.ts";

test("company network: missing deposit knowledge stays unknown, never false or approval", () => {
  const { depositReceived: _omitted, ...input } = baselineInput;
  const output = evaluateBusiness(input);
  assert.equal(output.decisions.procurement.status, "unknown");
  assert.ok(output.decisions.procurement.message.includes("depositReceived"));
});

test("company network: contradictory receipt claims are not resolved latest-wins", () => {
  const output = evaluateBusiness({ ...baselineInput,
    assertions: { depositReceived: [false, true] } });
  assert.equal(output.decisions.procurement.status, "conflict");
});

test("company network: current catalog cannot reprice an accepted agreement", () => {
  const before = evaluateBusiness(baselineInput);
  const after = evaluateBusiness({ ...baselineInput, catalogInstalledCents: 450_000 });
  assert.deepEqual(after.economics.agreedFirstYearCents, before.economics.agreedFirstYearCents);
  assert.deepEqual(after.economics.remainingInvoiceCents, before.economics.remainingInvoiceCents);
  assert.notDeepEqual(after.economics.currentOfferFirstYearCents, before.economics.currentOfferFirstYearCents);
  assert.deepEqual(after.impact.catalogInstalledCents, ["network.economics.currentOfferFirstYearCents"]);
});

test("company network: correct acceptance revision plus completed work is required", () => {
  assert.equal(evaluateBusiness(baselineInput).decisions.activation.status, "fail");
  assert.equal(evaluateBusiness({ ...baselineInput, installationCompleted: true,
    acceptedRevision: "scope-old" }).decisions.activation.status, "fail");
  assert.equal(evaluateBusiness({ ...baselineInput, installationCompleted: false,
    acceptedRevision: "scope-1" }).decisions.activation.status, "fail");
  assert.equal(evaluateBusiness({ ...baselineInput, installationCompleted: true,
    acceptedRevision: "scope-1" }).decisions.activation.status, "pass");
  const { acceptedRevision: _omitted, ...input } = baselineInput;
  assert.equal(evaluateBusiness(input).decisions.activation.status, "unknown");
});

test("company network: procurement checks actual receipt, funds and remaining kit independently", () => {
  const ready = { ...baselineInput, depositReceived: true };
  assert.equal(evaluateBusiness(ready).decisions.procurement.status, "pass");
  for (const change of [{ depositReceived: false }, { supplierCashCents: 89_999 }, { stockKits: 0 }]) {
    assert.equal(evaluateBusiness({ ...ready, ...change }).decisions.procurement.status, "fail");
  }
  assert.equal(evaluateBusiness({ ...ready, supplierCashCents: 90_000 }).decisions.procurement.status, "pass");
});

test("company network: installation threshold and unknown scope are explicit", () => {
  assert.equal(evaluateBusiness({ ...baselineInput, installerAvailableHours: 6 }).decisions.commissioning.status, "pass");
  assert.equal(evaluateBusiness({ ...baselineInput, installerAvailableHours: 5.99 }).decisions.commissioning.status, "fail");
  assert.equal(evaluateBusiness({ ...baselineInput, scopeValid: false }).decisions.commissioning.status, "fail");
  const { scopeValid: _omitted, ...input } = baselineInput;
  assert.equal(evaluateBusiness(input).decisions.commissioning.status, "unknown");
});

test("company network: synthetic economics are exact cents and input is not mutated", () => {
  const input = Object.freeze({ ...baselineInput });
  const before = JSON.stringify(input);
  const output = evaluateBusiness(input);
  assert.equal(output.evidence, "synthetic-assumptions");
  assert.equal(output.economics.agreedFirstYearCents.status, "known");
  if (output.economics.agreedFirstYearCents.status === "known") assert.equal(output.economics.agreedFirstYearCents.value, 480_000);
  if (output.economics.remainingInvoiceCents.status === "known") assert.equal(output.economics.remainingInvoiceCents.value, 330_000);
  if (output.economics.installedContributionCents.status === "known") assert.equal(output.economics.installedContributionCents.value, 150_000);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
  assert.ok(output.report.values.every(value => value.basis === "assumptions"));
});

test("company network: unsafe arithmetic is an error, not a rounded approval", () => {
  const output = evaluateBusiness({ ...baselineInput, agreementInstalledCents: Number.MAX_SAFE_INTEGER });
  assert.equal(output.economics.agreedFirstYearCents.status, "error");
});

test("company network: invalid supplied snapshots are rejected before evaluation", () => {
  assert.throws(() => evaluateBusiness({ ...baselineInput, supplierCashCents: -1 }));
  assert.throws(() => evaluateBusiness({ ...baselineInput, installerAvailableHours: NaN }));
  const sparse: boolean[] = [true];
  sparse.length = 2;
  assert.throws(() => evaluateBusiness({ ...baselineInput, assertions: { depositReceived: sparse } }));
});

test("company network: completed reservations are not treated as exhausted prerequisites", () => {
  const output = evaluateBusiness({ ...baselineInput, depositReceived: true,
    kitReserved: true, stockKits: 0, supplierCashCents: 110_000,
    capacityReserved: true, installerAvailableHours: 2, buyerCashCents: 850_000 });
  assert.equal(output.decisions.procurement.status, "pass");
  assert.equal(output.decisions.commissioning.status, "pass");
  assert.equal(output.economics.supplierCashAfterKitCents.status, "known");
  assert.equal(output.economics.buyerCashAfterDepositCents.status, "known");
  if (output.economics.supplierCashAfterKitCents.status === "known") assert.equal(output.economics.supplierCashAfterKitCents.value, 110_000);
  if (output.economics.buyerCashAfterDepositCents.status === "known") assert.equal(output.economics.buyerCashAfterDepositCents.value, 850_000);
  assert.equal(evaluateBusiness({ ...baselineInput, capacityReserved: true, scopeValid: false }).decisions.commissioning.status, "fail");
});

test("company network: graph and unresolved inputs preserve explicit dependency paths", () => {
  const { supplierCashCents: _omitted, ...input } = baselineInput;
  const output = evaluateBusiness(input);
  assert.equal(output.economics.supplierCashAfterKitCents.status, "unknown");
  assert.equal(output.decisions.procurement.status, "unknown");
  assert.equal(output.decisions.commissioning.status, "pass");
  assert.ok(output.graph.edges.some(edge => edge.from === "network.state.supplierCashCents" && edge.to === "network.decision.procurement"));
  assert.ok(output.graph.nodes.some(node => node.id === "network.state.supplierCashCents" && node.status === "unknown"));
});
