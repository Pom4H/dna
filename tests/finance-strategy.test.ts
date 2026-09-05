import { test } from "node:test";
import assert from "node:assert/strict";
import { assumption, type Scenario, type Value } from "../src/index.ts";
import * as m from "../examples/finance-strategy/model.ts";
import { admission, portion, project, selectPlan, sourceSchema } from "../examples/finance-strategy/engine.ts";

function read<T>(scenario: Scenario, value: Value<T>): T {
  const result = scenario.read(value);
  if (result.status !== "known") throw new Error(`${value.id}: ${result.status}`);
  return result.value;
}
function status(scenario: Scenario, id: string) { return scenario.evaluate().checks.find(check => check.id === id)?.status; }

test("finance/strategy: base plan selects two repeatable jobs and preserves the old commitment", () => {
  m.baseline.evaluate().assert();
  assert.deepEqual(read(m.baseline, m.plan).selected.map(order => order.id), ["repeat-a", "repeat-b"]);
  assert.equal(read(m.baseline, m.work).length, 3);
  assert.equal(read(m.baseline, m.plan).plannedHours, 80);
});

test("finance: independently computed delivery revenue, expenses, profit and cash reconcile", () => {
  const f = read(m.baseline, m.statements);
  assert.equal(f.revenueCents, 800000);
  assert.equal(f.expenseCents, 580000);
  assert.equal(f.profitCents, 220000);
  assert.equal(f.closingCashCents, 420000);
  assert.equal(f.receivablesCents, 0); assert.equal(f.deferredRevenueCents, 0);
  assert.equal(f.reconciliationCents, 0);
  assert.equal(read(m.baseline, m.cash.lowestBalance), 120000);
});

test("strategy counterexample: maximizing revenue rank increases revenue but reduces profit and violates cash/concentration", () => {
  const f = read(m.revenueFirst, m.statements);
  assert.equal(f.revenueCents, 1200000); assert.equal(f.profitCents, 120000);
  assert.equal(f.closingCashCents, 320000);
  assert.equal(read(m.revenueFirst, m.cash.lowestBalance), -680000);
  assert.equal(read(m.revenueFirst, m.cash.fundingGap), 680000);
  assert.equal(status(m.revenueFirst, m.workload.id), "pass");
  for (const check of [m.liquidity, m.concentration, m.profitGoal]) assert.equal(status(m.revenueFirst, check.id), "fail");
});

test("finance: collection delay changes receivables and liquidity, not earned revenue or profit", () => {
  const f = read(m.lateCollections, m.statements);
  assert.equal(f.revenueCents, 800000); assert.equal(f.profitCents, 220000);
  assert.equal(f.receivablesCents, 300000); assert.equal(f.closingCashCents, 120000);
  assert.equal(read(m.lateCollections, m.cash.lowestBalance), -80000);
  assert.equal(f.reconciliationCents, 0);
  assert.equal(status(m.lateCollections, m.profitGoal.id), "pass");
  assert.equal(status(m.lateCollections, m.liquidity.id), "fail");
});

test("finance: advances received before delivery remain liabilities, not earned revenue", () => {
  const at15 = m.baseline.set(m.horizon, assumption(15, "Pre-delivery snapshot"));
  const f = read(at15, m.statements);
  assert.equal(f.revenueCents, 200000); assert.equal(f.expenseCents, 280000);
  assert.equal(f.profitCents, -80000); assert.equal(f.closingCashCents, 420000);
  assert.equal(f.deferredRevenueCents, 300000); assert.equal(f.receivablesCents, 0);
  assert.equal(f.reconciliationCents, 0);
});

test("finance: delivering the service transfers deferred income into revenue and an unpaid receivable", () => {
  const f = read(m.baseline.set(m.horizon, assumption(30, "Delivery date inclusive")), m.statements);
  assert.equal(f.revenueCents, 800000); assert.equal(f.deferredRevenueCents, 0);
  assert.equal(f.receivablesCents, 300000); assert.equal(f.closingCashCents, 120000);
  assert.equal(f.reconciliationCents, 0);
});

test("finance: loan draw increases cash and debt, not revenue/profit; principal repayment is not an expense", () => {
  const draw = m.baseline.set(m.loans, assumption([{ id: "draw", day: 0, principalCents: 100000 }], "Synthetic principal, explicitly no interest"));
  const f = read(draw, m.statements), original = read(m.baseline, m.statements);
  assert.equal(f.profitCents, original.profitCents); assert.equal(f.revenueCents, original.revenueCents);
  assert.equal(f.closingCashCents, original.closingCashCents + 100000);
  assert.equal(f.debtCents, 100000); assert.equal(f.reconciliationCents, 0);
  const repaid = draw.set(m.loans, assumption([{ id: "draw", day: 0, principalCents: 100000 },
    { id: "repay", day: 70, principalCents: -100000 }], "Synthetic repayment"));
  const r = read(repaid, m.statements);
  assert.equal(r.expenseCents, original.expenseCents); assert.equal(r.closingCashCents, original.closingCashCents);
  assert.equal(r.debtCents, 0); assert.equal(r.reconciliationCents, 0);
});

test("finance: financing after the cash deficit cannot retrospectively make the plan liquid", () => {
  const fundedLate = m.revenueFirst.set(m.loans, assumption([{ id: "late-draw", day: 6, principalCents: 800000 }], "Funding arrives after direct costs"));
  assert.equal(read(fundedLate, m.cash.lowestBalance), -580000);
  assert.equal(status(fundedLate, m.cash.solvent.id), "fail");
});

test("strategy: a higher objective does not fabricate sales or silently change accepted agreements", () => {
  assert.deepEqual(m.baseline.read(m.statements), m.ambitiousTarget.read(m.statements));
  assert.deepEqual(m.baseline.read(m.plan), m.ambitiousTarget.read(m.plan));
  assert.equal(status(m.ambitiousTarget, m.profitGoal.id), "fail");
  assert.deepEqual(m.business.impact(m.target), ["strategy.profit-goal", "surface.strategy-review"]);
});

test("strategy: changing choice/rules changes commercial and financial surfaces, not historical obligations", () => {
  for (const value of [m.website, m.proposals, m.allocation, m.financialReport]) {
    assert.notEqual(read(m.baseline, value).content, read(m.revenueFirst, value).content);
  }
  assert.deepEqual(m.baseline.read(m.obligations), m.revenueFirst.read(m.obligations));
  assert.equal(read(m.revenueFirst, m.accepted)[0]!.depositBps, 0);
});

test("policy: a new deposit floor rejects new negotiations without changing a signed agreement", () => {
  const stricter = m.baseline.set(m.policy, assumption({ ...m.decisions.data.policy, minDepositBps: 6000 }, "Revised policy for NEW deals"));
  assert.equal(read(stricter, m.plan).selected.length, 0);
  assert.ok(read(stricter, m.plan).rejected.every(item => item.reasons.includes("deposit-below-floor")));
  assert.deepEqual(m.baseline.read(m.obligations), stricter.read(m.obligations));
});

test("policy: all failed admission rules have reasons; one passing condition never overrides another", () => {
  const enterprise = m.sources.data.opportunities[2]!;
  assert.deepEqual(admission(enterprise, m.decisions.data.choice, m.decisions.data.policy),
    ["outside-target-segment", "contribution-below-floor", "deposit-below-floor"]);
  const allRejected = selectPlan([], m.sources.data.opportunities, m.decisions.data.choice,
    { ...m.decisions.data.policy, minContributionBps: 10000 }, 120);
  assert.equal(allRejected.selected.length, 0);
});

test("policy: individually eligible jobs compete for shared capacity, including reserved investment time", () => {
  const jobs = m.sources.data.opportunities.slice(0, 2);
  assert.ok(jobs.every(order => admission(order, m.decisions.data.choice, m.decisions.data.policy).length === 0));
  const limited = selectPlan(m.sources.data.accepted, jobs, m.decisions.data.choice, m.decisions.data.policy, 70);
  assert.equal(limited.selected.length, 1);
  assert.ok(limited.rejected[0]!.reasons.includes("capacity-reserved-or-exhausted"));
  assert.equal(limited.plannedHours, 50);
});

test("policy: already overcommitted work fails the capacity rule rather than disappearing", () => {
  const overload = m.baseline.set(m.capacity, assumption(10, "Existing work already exceeds this capacity"));
  assert.equal(read(overload, m.plan).selected.length, 0);
  assert.equal(read(overload, m.work)[0]!.id, "legacy");
  assert.equal(status(overload, m.workload.id), "fail");
});

test("strategy downside: no conversions means no proposed revenue, while old obligations and overhead remain", () => {
  const f = read(m.lostDemand, m.statements);
  assert.equal(f.revenueCents, 200000); assert.equal(f.expenseCents, 380000); assert.equal(f.profitCents, -180000);
  assert.equal(read(m.lostDemand, m.plan).selected.length, 0);
  assert.equal(status(m.lostDemand, m.profitGoal.id), "fail");
  assert.deepEqual(m.baseline.read(m.obligations), m.lostDemand.read(m.obligations));
});

test("finance: every day in the bounded horizon reconciles, including prepayment and late collection states", () => {
  for (const base of [m.baseline, m.lateCollections, m.revenueFirst]) for (let day = 0; day <= 90; day++) {
    const f = read(base.set(m.horizon, assumption(day, "Bounded daily reconciliation")), m.statements);
    assert.equal(f.reconciliationCents, 0, `${base.name}/${day}`);
  }
});

test("policy: finite threshold sweep preserves capacity and every selected admission constraint", () => {
  let cases = 0;
  for (const reserveHours of [0, 20, 80]) for (const minDepositBps of [0, 5000, 10000]) for (const minContributionBps of [0, 4000, 9000]) {
    const choice = { ...m.decisions.data.choice, reserveHours };
    const policy = { ...m.decisions.data.policy, minDepositBps, minContributionBps };
    const plan = selectPlan(m.sources.data.accepted, m.sources.data.opportunities, choice, policy, 120);
    assert.ok(plan.plannedHours + reserveHours <= 120);
    assert.ok(plan.selected.every(order => admission(order, choice, policy).length === 0));
    cases++;
  }
  assert.equal(cases, 27);
});

test("finance: input reordering does not change the selected portfolio or financial numbers", () => {
  const reversed = m.baseline.set(m.opportunities, assumption([...m.sources.data.opportunities].reverse(), "Source row order changes"));
  assert.deepEqual(read(reversed, m.plan), read(m.baseline, m.plan));
  assert.deepEqual(read(reversed, m.statements), read(m.baseline, m.statements));
});

test("finance: exact integer deposit rounding preserves total customer consideration", () => {
  assert.equal(portion(101, 5000), 50);
  assert.equal(portion(Number.MAX_SAFE_INTEGER, 10000), Number.MAX_SAFE_INTEGER);
  assert.equal(portion(101, 5000) + (101 - portion(101, 5000)), 101);
});

test("finance boundaries: duplicate work cannot appear in accepted and pipeline data", () => {
  const duplicate = m.baseline.set(m.opportunities, assumption([...m.sources.data.accepted], "Duplicate source identity"));
  assert.equal(duplicate.read(m.plan).status, "error");
});

test("finance boundaries: invalid timelines, duplicate expenses and excess principal repayments are rejected", () => {
  const order = m.sources.data.accepted[0]!, treasury = m.sources.data.treasury;
  assert.throws(() => project([{ ...order, remainderDay: 1 }], treasury, [], 90, 0), /timeline/);
  assert.throws(() => project([order], { ...treasury, expenses: [...treasury.expenses, treasury.expenses[0]!] }, [], 90, 0), /Duplicate/);
  assert.throws(() => project([order], treasury, [{ id: "overpay", day: 0, principalCents: -1 }], 90, 0), /Repayment/);
});

test("finance boundaries: fixed currency rejects unsupported FX instead of silently adding unlike units", () => {
  const invalid: unknown = { ...m.sources.data, treasury: { ...m.sources.data.treasury, currency: "EUR" } };
  assert.throws(() => sourceSchema.parse(invalid), /USD/);
});

test("finance boundaries: overflow becomes an evaluation error, not a plausible-looking result", () => {
  const overflow = m.baseline.set(m.treasury, assumption({ ...m.sources.data.treasury, openingCashCents: Number.MAX_SAFE_INTEGER }, "Overflow boundary"));
  assert.equal(overflow.read(m.statements).status, "error");
});

test("strategy limits: a scenario and a green profit goal are not evidence that a strategy will work", () => {
  assert.equal(status(m.baseline, m.profitGoal.id), "pass");
  assert.equal(m.baseline.evaluate().checks.find(check => check.id === m.profitGoal.id)?.conclusion, "conditional");
  for (const scenario of m.scenarios) assert.throws(() => scenario.evaluate().assert({ requireObservations: true }));
  const unknown = m.business.scenario("no-sources");
  assert.equal(unknown.read(m.statements).status, "unknown");
});
