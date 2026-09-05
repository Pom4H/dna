import { s, type Infer } from "../../src/index.ts";
import { cashMovement } from "../../src/domains/cashflow.ts";

// Deliberately local to this experiment. These are not new DNA core primitives.
export const cents = s.number({ integer: true });
const positive = s.number({ integer: true, min: 1 });
const nonnegative = s.number({ integer: true, min: 0 });
const bps = s.number({ integer: true, min: 0, max: 10_000 });
export const orderSchema = s.object({
  id: s.string({ minLength: 1 }), customer: s.string({ minLength: 1 }),
  segment: s.enum("repeatable", "custom"), feeCents: positive,
  directCostCents: nonnegative, hours: positive, depositBps: bps,
  startDay: nonnegative, costDay: nonnegative, completionDay: nonnegative, remainderDay: nonnegative,
});
export const ordersSchema = s.array(orderSchema);
export type Order = Infer<typeof orderSchema>;
export const choiceSchema = s.object({
  segment: s.enum("repeatable", "any"), rankBy: s.enum("contribution", "revenue"), reserveHours: nonnegative,
});
export const policySchema = s.object({
  minContributionBps: bps, minDepositBps: bps, minCashCents: nonnegative, maxCustomerShareBps: bps,
});
export type Choice = Infer<typeof choiceSchema>;
export type Policy = Infer<typeof policySchema>;
export const treasurySchema = s.object({ currency: s.enum("USD"), openingCashCents: nonnegative,
  expenses: s.array(s.object({ id: s.string({ minLength: 1 }), day: nonnegative, amountCents: nonnegative })),
});
export type Treasury = Infer<typeof treasurySchema>;
export const loansSchema = s.array(s.object({ id: s.string({ minLength: 1 }), day: nonnegative, principalCents: cents }));
export type Loans = Infer<typeof loansSchema>;
export const sourceSchema = s.object({ treasury: treasurySchema, accepted: ordersSchema,
  opportunities: ordersSchema, capacityHours: nonnegative, loans: loansSchema,
});
export const decisionSourceSchema = s.object({ choice: choiceSchema, policy: policySchema,
  targetProfitCents: cents, horizonDay: nonnegative, paymentDelayDays: nonnegative,
});
export const planSchema = s.object({
  selected: ordersSchema, rejected: s.array(s.object({ id: s.string(), reasons: s.array(s.string()) })),
  committedHours: nonnegative, plannedHours: nonnegative,
});
export const statementsSchema = s.object({
  revenueCents: cents, expenseCents: cents, profitCents: cents, closingCashCents: cents,
  receivablesCents: nonnegative, deferredRevenueCents: nonnegative, debtCents: nonnegative,
  equityCents: cents, reconciliationCents: cents, cashMovements: s.array(cashMovement),
});

function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Unsafe integer arithmetic in finance projection");
  }
  return Number(value);
}
export function total(values: readonly number[]): number {
  return safe(values.reduce((sum, value) => sum + BigInt(cents.parse(value)), 0n));
}
export function portion(value: number, rateBps: number): number {
  return safe(BigInt(nonnegative.parse(value)) * BigInt(bps.parse(rateBps)) / 10_000n);
}
function unique(ids: readonly string[], kind: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${kind} identity`);
}
function checkedOrders(input: readonly Order[]): readonly Order[] {
  const orders = ordersSchema.parse(input);
  unique(orders.map(order => order.id), "order");
  for (const order of orders) {
    if (order.costDay < order.startDay || order.completionDay < order.startDay || order.remainderDay < order.completionDay) {
      throw new Error(`${order.id}: invalid order timeline`);
    }
  }
  return orders;
}

/** Named, conjunctive admission rules. No silent exceptions or last-rule-wins. */
export function admission(order: Order, choice: Choice, policy: Policy): readonly string[] {
  checkedOrders([order]); choiceSchema.parse(choice); policySchema.parse(policy);
  const reasons: string[] = [];
  if (choice.segment !== "any" && order.segment !== choice.segment) reasons.push("outside-target-segment");
  if (BigInt(order.feeCents - order.directCostCents) * 10_000n < BigInt(order.feeCents) * BigInt(policy.minContributionBps)) reasons.push("contribution-below-floor");
  if (order.depositBps < policy.minDepositBps) reasons.push("deposit-below-floor");
  return reasons;
}

/** Greedy, deterministic candidate planning, NOT optimal allocation or deal acceptance.
 * Opportunities are assumed to convert if selected; real demand is not inferred.
 * Existing commitments remain obligations even when a new policy would reject them.
 */
export function selectPlan(acceptedInput: readonly Order[], opportunitiesInput: readonly Order[],
  choiceInput: Choice, policyInput: Policy, capacityHours: number): Infer<typeof planSchema> {
  const accepted = checkedOrders(acceptedInput), opportunities = checkedOrders(opportunitiesInput);
  unique([...accepted, ...opportunities].map(order => order.id), "order");
  const choice = choiceSchema.parse(choiceInput), policy = policySchema.parse(policyInput);
  nonnegative.parse(capacityHours);
  const committedHours = total(accepted.map(order => order.hours));
  let used = committedHours;
  const selected: Order[] = [];
  const rejected: { id: string; reasons: string[] }[] = [];
  const score = (order: Order) => choice.rankBy === "revenue" ? order.feeCents : order.feeCents - order.directCostCents;
  const ranked = [...opportunities].sort((a, b) => score(a) === score(b)
    ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : score(a) > score(b) ? -1 : 1);
  for (const order of ranked) {
    const reasons = [...admission(order, choice, policy)];
    if (BigInt(used) + BigInt(order.hours) + BigInt(choice.reserveHours) > BigInt(capacityHours)) reasons.push("capacity-reserved-or-exhausted");
    if (reasons.length) rejected.push({ id: order.id, reasons });
    else { selected.push(order); used = total([used, order.hours]); }
  }
  return planSchema.parse({ selected, rejected, committedHours, plannedHours: used });
}

/** Explicit toy accounting policy: revenue at full delivery; direct costs expensed
 * and paid on costDay; overhead expensed/paid on its scheduled day; deposits are
 * liabilities until delivery; remainder is receivable until collected. No tax,
 * capitalization, opening receivables/debt, interest, bad debt, refunds or FX.
 * A negative projected cash balance is a funding need, not an implicit overdraft.
 */
export function project(ordersInput: readonly Order[], treasuryInput: Treasury, loansInput: Loans,
  horizonDay: number, paymentDelayDays: number): Infer<typeof statementsSchema> {
  const orders = checkedOrders(ordersInput), treasury = treasurySchema.parse(treasuryInput), loans = loansSchema.parse(loansInput);
  nonnegative.parse(horizonDay); nonnegative.parse(paymentDelayDays);
  unique(treasury.expenses.map(item => item.id), "expense"); unique(loans.map(item => item.id), "loan event");
  const movements: Infer<typeof cashMovement>[] = [];
  const revenues: number[] = [], expenses: number[] = [], receivables: number[] = [], deferred: number[] = [];
  for (const order of orders) {
    const deposit = portion(order.feeCents, order.depositBps);
    const finalDay = total([order.remainderDay, paymentDelayDays]);
    movements.push({ id: JSON.stringify(["order", order.id, "deposit"]), day: order.startDay, amountCents: deposit },
      { id: JSON.stringify(["order", order.id, "remainder"]), day: finalDay, amountCents: order.feeCents - deposit },
      { id: JSON.stringify(["order", order.id, "cost"]), day: order.costDay, amountCents: -order.directCostCents });
    const collected = total([order.startDay <= horizonDay ? deposit : 0, finalDay <= horizonDay ? order.feeCents - deposit : 0]);
    const delivered = order.completionDay <= horizonDay;
    revenues.push(delivered ? order.feeCents : 0);
    expenses.push(order.costDay <= horizonDay ? order.directCostCents : 0);
    receivables.push(delivered ? order.feeCents - collected : 0);
    deferred.push(delivered ? 0 : collected);
  }
  for (const expense of treasury.expenses) {
    movements.push({ id: JSON.stringify(["expense", expense.id]), day: expense.day, amountCents: -expense.amountCents });
    expenses.push(expense.day <= horizonDay ? expense.amountCents : 0);
  }
  let debtCents = 0;
  // Principal outflows precede inflows on the same day, consistent with the cash engine.
  for (const loan of [...loans].sort((a, b) => a.day - b.day || a.principalCents - b.principalCents)) {
    movements.push({ id: JSON.stringify(["loan", loan.id]), day: loan.day, amountCents: loan.principalCents });
    if (loan.day <= horizonDay) {
      debtCents = total([debtCents, loan.principalCents]);
      if (debtCents < 0) throw new Error("Repayment exceeds modeled outstanding principal");
    }
  }
  const revenueCents = total(revenues), expenseCents = total(expenses);
  const profitCents = total([revenueCents, -expenseCents]);
  const closingCashCents = total([treasury.openingCashCents, ...movements.filter(item => item.day <= horizonDay).map(item => item.amountCents)]);
  const receivablesCents = total(receivables), deferredRevenueCents = total(deferred);
  const equityCents = total([treasury.openingCashCents, profitCents]);
  const reconciliationCents = total([closingCashCents, receivablesCents, -deferredRevenueCents, -debtCents, -equityCents]);
  return statementsSchema.parse({ revenueCents, expenseCents, profitCents, closingCashCents, receivablesCents,
    deferredRevenueCents, debtCents, equityCents, reconciliationCents, cashMovements: movements });
}
