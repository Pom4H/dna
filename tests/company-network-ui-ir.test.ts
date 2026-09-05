import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineInput, evaluateBusiness } from "../examples/company-network/model.ts";
import { projectCompanyUI, validateUiIR, type UiIR } from "../examples/company-network/ui-ir.ts";
import type { Session } from "../examples/company-network/authority.ts";

const arbitrary: UiIR = {
  schema: "dna.ui", version: "0.1", title: "Arbitrary subject model", subtitle: "Synthetic",
  subjects: ["school", "garden", "library", "weather-station"].map(id => ({
    id, label: id, role: "independent subject", color: "mint", state: "known",
    metrics: [{ id: "count", label: "Count", value: "1", unit: "item" }],
  })),
  relations: [{ id: "r", from: "school", to: "weather-station", label: "reads", state: "active" }],
  actions: [{ id: "inspect", actor: "library", label: "Inspect", enabled: false, reason: "read only" }],
  decisions: [{ id: "d", label: "Sample", subjectId: "garden", status: "unknown", message: "Missing reading" }],
  events: [], contract: { id: "c", revision: "r1", totalCents: 0, remainingCents: 0, currency: "EUR" },
};

test("UI IR accepts an arbitrary fourth subject without company or shell assumptions", () => {
  assert.deepEqual(validateUiIR(arbitrary), arbitrary);
  assert.equal(validateUiIR(arbitrary).subjects[3]?.id, "weather-station");
});

test("UI IR rejects dangling relations, actions and decisions", () => {
  assert.throws(() => validateUiIR({ ...arbitrary, relations: [{ ...arbitrary.relations[0], to: "missing" }] }));
  assert.throws(() => validateUiIR({ ...arbitrary, actions: [{ ...arbitrary.actions[0], actor: "missing" }] }));
  assert.throws(() => validateUiIR({ ...arbitrary, decisions: [{ ...arbitrary.decisions[0], subjectId: "missing" }] }));
});

test("UI IR excludes shell/theme and rejects duplicate identities and malformed money", () => {
  assert.throws(() => validateUiIR({ ...arbitrary, theme: "dark" }));
  assert.throws(() => validateUiIR({ ...arbitrary, shell: "canvas" }));
  assert.throws(() => validateUiIR({ ...arbitrary, subjects: [arbitrary.subjects[0], arbitrary.subjects[0]] }));
  assert.throws(() => validateUiIR({ ...arbitrary, contract: { ...arbitrary.contract, totalCents: 1.5 } }));
});

const session: Session = {
  id: "fictional-session", version: 0, scopeRevision: "scope-1", scenario: "baseline", createdAt: "2027-01-01T00:00:00.000Z",
  terms: { agreementInstalledCents: 300_000, agreementAnnualSaasCents: 180_000, depositCents: 150_000,
    kitCostCents: 90_000, installationCostCents: 60_000, installationHours: 6 },
  buyerCashCents: 1_000_000, supplierCashCents: 200_000, installerCashCents: 0,
  stockKits: 1, installerAvailableHours: 8, depositReceived: false, kitReserved: false, capacityReserved: false,
  installationCompleted: false, acceptedRevision: null, subscriptionActive: false, capacityRepaired: false,
  events: [], receipts: {},
};

test("UI projection preserves unknown and conflict and does not offer gated commands", () => {
  const { depositReceived: _omitted, ...unknown } = baselineInput;
  const ui = projectCompanyUI(session, evaluateBusiness(unknown));
  assert.equal(ui.decisions.find(item => item.id === "procurement")?.status, "unknown");
  assert.equal(ui.actions.find(item => item.id === "pay")?.enabled, false);
  assert.ok(ui.knowledge?.facts.some(fact => fact.status === "unknown" && fact.value === "Неизвестно"));
  const conflict = projectCompanyUI(session, evaluateBusiness({ ...baselineInput, assertions: { depositReceived: [true] } }));
  assert.equal(conflict.decisions.find(item => item.id === "procurement")?.status, "conflict");
  assert.ok(conflict.knowledge?.facts.some(fact => fact.status === "conflict" && fact.value === "Конфликт"));
});

test("UI projection is plain JSON, carries provenance, and never mutates authority or evaluation", () => {
  const evaluation = evaluateBusiness(baselineInput);
  const before = JSON.stringify({ session, evaluation });
  const ui = projectCompanyUI(session, evaluation, [{ id: "evt", at: "2027-01-01T00:00:00.000Z",
    company: "buyer", type: "step", label: "Synthetic step", detail: "Synthetic details", attempt: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(ui)), ui);
  assert.equal(ui.events[0]?.actor, "buyer");
  assert.equal(ui.contract.totalCents, 480_000);
  assert.equal(ui.contract.remainingCents, 330_000);
  assert.ok(ui.knowledge?.facts.some(fact => fact.provenance.length > 0));
  assert.equal(JSON.stringify({ session, evaluation }), before);
});

test("UI subject metrics do not silently display a disputed numeric value", () => {
  const evaluation = evaluateBusiness({ ...baselineInput, assertions: { buyerCashCents: [0] } });
  const ui = projectCompanyUI(session, evaluation);
  assert.equal(ui.subjects.find(subject => subject.id === "buyer")?.metrics.find(metric => metric.id === "cash")?.value, "Конфликт");
  assert.equal(ui.actions.find(action => action.id === "pay")?.enabled, false);
});
