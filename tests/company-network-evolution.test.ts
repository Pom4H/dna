import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCandidates, evaluateCandidate, searchContext } from "../examples/company-network/evolution.ts";

test("future-offer search rejects a higher-margin shortcut that violates minimum quality", () => {
  const result = evaluateCandidates();
  const shortcut = result.candidates.find(candidate => candidate.id === "future-3000-h5");
  assert.ok(shortcut);
  assert.equal(shortcut.feasible, false);
  assert.equal(shortcut.decisions.quality.status, "fail");
  assert.notEqual(result.bestId, shortcut.id);
});

test("future-offer search ranks only feasible offers and preserves buyer rejection", () => {
  const result = evaluateCandidates();
  assert.equal(result.candidates.length, 7);
  assert.equal(result.bestId, "future-3000-h6");
  assert.equal(result.baseline.id, "future-3000-h8");
  assert.equal(result.baseline.metrics.unitMarginCents, 160_000);
  const best = result.candidates.find(candidate => candidate.id === result.bestId);
  assert.equal(best?.metrics.unitMarginCents, 170_000);
  assert.equal(best?.metrics.buyerRemainingBenefitCents, 10_000);
  assert.ok(result.candidates.filter(candidate => candidate.offer.installedPriceCents === 320_000)
    .every(candidate => !candidate.feasible && candidate.decisions.buyer.status === "fail"));
});

test("future-offer cash gate includes installation cash before final customer payment", () => {
  const result = evaluateCandidate({ id: "cash-counterexample", installedPriceCents: 280_000, installationHours: 8 },
    { ...searchContext, supplierOpeningCashCents: 0, depositPercent: 20 });
  assert.equal(result.metrics.unitMarginCents, 140_000);
  assert.ok(result.metrics.minimumSupplierCashCents < 0);
  assert.equal(result.decisions.cash.status, "fail");
  assert.equal(result.feasible, false);
});

test("future-offer capacity is independent of contribution and does not reserve time", () => {
  const context = Object.freeze({ ...searchContext, installerAvailableHours: 5 });
  const before = JSON.stringify(context);
  const result = evaluateCandidate({ id: "capacity-counterexample", installedPriceCents: 300_000, installationHours: 6 }, context);
  assert.equal(result.decisions.capacity.status, "fail");
  assert.equal(result.feasible, false);
  assert.equal(JSON.stringify(context), before);
});

test("future-offer search is reproducible plain JSON and all evidence remains synthetic", () => {
  const first = evaluateCandidates();
  assert.deepEqual(evaluateCandidates(), first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.evidence, "synthetic-assumptions");
  assert.ok(first.candidates.every(candidate => Object.values(candidate.decisions).every(decision => decision.basis === "assumptions")));
  assert.ok(first.description.includes("bounded synthetic search"));
});
