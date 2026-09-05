import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assumption, fact, model, s } from "../src/index.ts";
import { cashflow, cashMovement } from "../src/domains/cashflow.ts";
import { baseline, growth, latePayment, cash, modeledProfit, dna, orders } from "../examples/cashflow.ts";

function fixture() {
  const openingCash = fact("cash", s.number({ integer: true, min: 0 }));
  const horizonDay = fact("horizon", s.number({ integer: true, min: 0 }));
  const movements = fact("movements", s.array(cashMovement));
  const flow = cashflow("fixture", { openingCash, horizonDay, movements }, "USD");
  const dna = model({ id: "cash-tests", version: "1", values: [flow.fundingGap], checks: [flow.solvent] });
  const scenario = dna.scenario("cash-test").set(openingCash, assumption(100, "Fixture"))
    .set(horizonDay, assumption(10, "Fixture"));
  return { openingCash, horizonDay, movements, flow, scenario };
}

describe("cash is different from modeled profit", () => {
  test("baseline is profitable and remains liquid", () => {
    baseline.evaluate().assert();
    const profit = baseline.read(modeledProfit);
    const balance = baseline.read(cash.lowestBalance);
    assert.ok(profit.status === "known" && profit.value === 20_000);
    assert.ok(balance.status === "known" && balance.value === 70_000);
  });
  test("growth raises modeled profit while creating an upfront cash shortfall", () => {
    const profit = growth.read(modeledProfit);
    const gap = growth.read(cash.fundingGap);
    assert.ok(profit.status === "known" && profit.value === 140_000);
    assert.ok(gap.status === "known" && gap.value === 10_000);
    assert.equal(growth.evaluate().checks.find(check => check.id === cash.solvent.id)!.status, "fail");
    assert.throws(() => growth.evaluate().assert(), /First cash shortfall on day 0/);
  });
  test("late payment changes liquidity, not this recognized-profit calculation", () => {
    assert.deepEqual(latePayment.read(modeledProfit), baseline.read(modeledProfit));
    const gap = latePayment.read(cash.fundingGap);
    assert.ok(gap.status === "known" && gap.value === 30_000);
    assert.throws(() => latePayment.evaluate().assert(), /First cash shortfall on day 60/);
  });
  test("impact connects one sales input to both commercial and cash-flow hypotheses", () => {
    const impacted = dna.impact(orders);
    assert.ok(impacted.includes(modeledProfit.id));
    assert.ok(impacted.includes(cash.solvent.id));
    assert.ok(impacted.includes(cash.fundingGap.id));
  });
  test("all bundled business conclusions remain conditional", () => {
    for (const scenario of [baseline, growth, latePayment]) {
      for (const check of scenario.evaluate().checks) assert.equal(check.conclusion, "conditional");
      assert.throws(() => scenario.evaluate().assert({ requireObservations: true }));
    }
  });
});

describe("cash timeline boundaries", () => {
  test("events are chronological; same-day outflows precede receipts", () => {
    const { scenario, movements, flow } = fixture();
    const result = scenario.set(movements, assumption([
      { id: "receipt", day: 1, amountCents: 200 },
      { id: "expense", day: 1, amountCents: -200 },
    ], "Order must not hide intraday cash needs")).read(flow.ledger);
    assert.ok(result.status === "known");
    if (result.status === "known") {
      assert.equal(result.value[0]!.id, "expense");
      assert.equal(result.value[0]!.balanceCents, -100);
      assert.equal(result.value[1]!.balanceCents, 100);
    }
  });
  test("horizon is inclusive and a later receipt cannot fix an earlier shortfall", () => {
    const { scenario, movements, flow } = fixture();
    const result = scenario.set(movements, assumption([
      { id: "expense", day: 10, amountCents: -101 },
      { id: "receipt", day: 11, amountCents: 500 },
    ], "Horizon boundary")).read(flow.ledger);
    assert.ok(result.status === "known" && result.value.length === 1 && result.value[0]!.balanceCents === -1);
  });
  test("duplicate event identities are errors, not double-counted cash", () => {
    const { scenario, movements, flow } = fixture();
    const result = scenario.set(movements, assumption([
      { id: "same", day: 1, amountCents: -10 },
      { id: "same", day: 2, amountCents: -10 },
    ], "Duplicate fixture")).read(flow.ledger);
    assert.equal(result.status, "error");
  });
  test("explicitly empty cash schedule differs from an unknown schedule", () => {
    const { scenario, movements } = fixture();
    assert.equal(scenario.evaluate().checks[0]!.status, "unknown");
    scenario.set(movements, assumption([], "Explicitly model no cash movements")).evaluate().assert();
  });
  test("intermediate overflow is detected even if later events reverse it", () => {
    const { scenario, movements, flow, openingCash } = fixture();
    const result = scenario.set(openingCash, assumption(Number.MAX_SAFE_INTEGER, "Boundary"))
      .set(movements, assumption([
        { id: "in", day: 1, amountCents: 1 },
        { id: "out", day: 2, amountCents: -1 },
      ], "Intermediate overflow")).read(flow.ledger);
    assert.equal(result.status, "error");
  });
});
