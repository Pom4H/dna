import { artifact, assumption, derive, fact, hypothesis, inconclusive, model, rule, s } from "../../src/index.ts";
import { cashflow, cashMovement } from "../../src/domains/cashflow.ts";
import { snapshot } from "../cross-domain/snapshots.ts";
import { cents, choiceSchema, decisionSourceSchema, loansSchema, ordersSchema, planSchema, policySchema,
  project, selectPlan, sourceSchema, statementsSchema, total, treasurySchema } from "./engine.ts";

export const sources = snapshot(new URL("./sources.json", import.meta.url), sourceSchema);
export const decisions = snapshot(new URL("./decision.json", import.meta.url), decisionSourceSchema);
// Separate snapshots are read-only inputs. DNA does not accept deals or write to a bank.
export const accepted = fact("agreements.accepted", ordersSchema);
export const opportunities = fact("crm.opportunities", ordersSchema);
export const treasury = fact("finance.treasury", treasurySchema);
export const loans = fact("finance.loan-principal", loansSchema);
export const capacity = fact("planning.capacity-hours", s.number({ integer: true, min: 0 }));
export const choice = fact("strategy.choice", choiceSchema);
export const policy = fact("policy.new-deals", policySchema);
export const target = fact("strategy.target-profit", cents, { unit: "USD cents over the declared horizon" });
export const horizon = fact("planning.horizon-day", s.number({ integer: true, min: 0 }));
export const delay = fact("environment.collection-delay-days", s.number({ integer: true, min: 0 }));

export const plan = derive("strategy.candidate-plan", planSchema,
  { accepted, opportunities, choice, policy, capacity }, input => selectPlan(input.accepted, input.opportunities, input.choice, input.policy, input.capacity));
export const work = derive("planning.work", ordersSchema, { accepted, plan }, ({ accepted, plan }) => [...accepted, ...plan.selected]);
export const statements = derive("finance.statements", statementsSchema, { work, treasury, loans, horizon, delay },
  ({ work, treasury, loans, horizon, delay }) => project(work, treasury, loans, horizon, delay));
const openingCash = derive("finance.opening-cash", cents, { treasury }, ({ treasury }) => treasury.openingCashCents);
const movements = derive("finance.movements", s.array(cashMovement), { statements }, ({ statements }) => statements.cashMovements);
export const cash = cashflow("finance.cash", { openingCash, horizonDay: horizon, movements }, "USD");

export const liquidity = rule("policy.cash-buffer", { lowest: cash.lowestBalance, policy },
  ({ lowest, policy }) => lowest >= policy.minCashCents, "The plan preserves the cash buffer at every modeled cash event");
export const workload = rule("policy.capacity", { plan, choice, capacity },
  ({ plan, choice, capacity }) => total([plan.plannedHours, choice.reserveHours]) <= capacity,
  "Committed work plus selected opportunities preserves explicitly reserved capacity");
export const concentration = rule("policy.customer-concentration", { work, policy }, ({ work, policy }) => {
  const amounts = new Map<string, bigint>();
  for (const order of work) amounts.set(order.customer, (amounts.get(order.customer) ?? 0n) + BigInt(order.feeCents));
  const sum = [...amounts.values()].reduce((a, b) => a + b, 0n);
  if (sum === 0n) return inconclusive("No contracted/planned fees: customer concentration is undefined");
  return [...amounts.values()].every(amount => amount * 10_000n <= sum * BigInt(policy.maxCustomerShareBps));
}, "No customer exceeds the policy share of full accepted/planned fees (not only cash collected)");
export const reconciliation = rule("finance.reconciles", { statements }, ({ statements }) => statements.reconciliationCents === 0,
  "Within this simplified model: cash + receivables = deferred revenue + debt + equity");
export const profitGoal = hypothesis("strategy.profit-goal", { statements, target },
  ({ statements, target }) => statements.profitCents >= target, "The selected plan reaches the declared profit goal under supplied assumptions");

export const website = artifact("surface.offer", { kind: "website", path: "site/service.json", mediaType: "application/json",
  dependencies: { choice, policy }, render: ({ choice, policy }) => JSON.stringify({ targetSegment: choice.segment, minimumDepositBps: policy.minDepositBps }) });
export const proposals = artifact("surface.proposals", { kind: "sales", path: "sales/candidates.json", mediaType: "application/json",
  dependencies: { plan }, render: ({ plan }) => JSON.stringify({ status: "simulation-only", selected: plan.selected, rejected: plan.rejected }) });
export const obligations = artifact("surface.accepted-work", { kind: "document", path: "delivery/accepted.json", mediaType: "application/json",
  dependencies: { accepted }, render: ({ accepted }) => JSON.stringify(accepted) });
export const allocation = artifact("surface.capacity", { kind: "data", path: "planning/allocation.json", mediaType: "application/json",
  dependencies: { plan, choice }, render: ({ plan, choice }) => JSON.stringify({ workHours: plan.plannedHours, reservedHours: choice.reserveHours }) });
export const financialReport = artifact("surface.finance", { kind: "data", path: "finance/projection.json", mediaType: "application/json",
  dependencies: { statements, minimumCash: cash.lowestBalance }, render: input => JSON.stringify(input) });
export const strategyReview = artifact("surface.strategy-review", { kind: "document", path: "strategy/review.json", mediaType: "application/json",
  dependencies: { statements, target }, render: ({ statements, target }) => JSON.stringify({ targetProfitCents: target,
    projectedProfitCents: statements.profitCents, decision: statements.profitCents >= target ? "goal-met-in-model" : "review-assumptions-or-plan" }) });
export const surfaces = [website, proposals, obligations, allocation, financialReport, strategyReview];
export const business = model({ id: "finance-strategy", version: "experiment-1", values: surfaces,
  checks: [liquidity, workload, concentration, reconciliation, profitGoal, cash.solvent] });

export const baseline = business.scenario("repeatable-focus")
  .set(accepted, sources.input(sources.data.accepted, "accepted"))
  .set(opportunities, sources.input(sources.data.opportunities, "opportunities"))
  .set(treasury, sources.input(sources.data.treasury, "treasury"))
  .set(loans, sources.input(sources.data.loans, "loans"))
  .set(capacity, sources.input(sources.data.capacityHours, "capacityHours"))
  .set(choice, decisions.input(decisions.data.choice, "choice"))
  .set(policy, decisions.input(decisions.data.policy, "policy"))
  .set(target, decisions.input(decisions.data.targetProfitCents, "targetProfitCents"))
  .set(horizon, decisions.input(decisions.data.horizonDay, "horizonDay"))
  .set(delay, decisions.input(decisions.data.paymentDelayDays, "paymentDelayDays"));
export const revenueFirst = baseline.fork("revenue-first")
  .set(choice, assumption({ segment: "any", rankBy: "revenue", reserveHours: 0 }, "Synthetic alternative: maximize greedy revenue rank"))
  .set(policy, assumption({ ...decisions.data.policy, minContributionBps: 2500, minDepositBps: 0 }, "Synthetic alternative admission thresholds"));
export const lateCollections = baseline.fork("collections-sixty-days-late")
  .set(delay, assumption(60, "Stress all remainder payments, including the existing agreement; no effect on deposit dates"));
export const ambitiousTarget = baseline.fork("higher-target-same-plan")
  .set(target, assumption(500000, "A higher goal is not a revenue assumption"));
export const lostDemand = baseline.fork("no-new-deals-convert")
  .set(opportunities, assumption([], "Explicit no-demand downside, not a probability estimate"));
export const scenarios = [baseline, revenueFirst, lateCollections, ambitiousTarget, lostDemand];
