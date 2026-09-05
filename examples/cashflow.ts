import { assumption, derive, fact, hypothesis, model, s } from "../src/index.ts";
import { cashflow, cashMovement } from "../src/domains/cashflow.ts";

// Fictional units and timings, unrelated to any real company or personal finances.
export const orders = fact("launch.orders", s.number({ integer: true, min: 0 }));
export const price = fact("launch.price", s.number({ integer: true, min: 0 }), { unit: "USD cents/order" });
export const unitCost = fact("launch.unit-cost", s.number({ integer: true, min: 0 }), { unit: "USD cents/order" });
export const overhead = fact("launch.overhead", s.number({ integer: true, min: 0 }), { unit: "USD cents/30 days" });
export const openingCash = fact("launch.opening-cash", s.number({ integer: true, min: 0 }), { unit: "USD cents" });
export const collectionDay = fact("launch.collection-day", s.number({ integer: true, min: 0 }));
export const horizonDay = fact("launch.horizon-day", s.number({ integer: true, min: 60, max: 60 }));

export const modeledProfit = derive("launch.modeled-profit", s.number({ integer: true }),
  { orders, price, unitCost, overhead }, ({ orders, price, unitCost, overhead }) => {
    const safe = s.number({ integer: true });
    const revenue = safe.parse(orders * price);
    const costs = safe.parse(safe.parse(orders * unitCost) + safe.parse(2 * overhead));
    return safe.parse(revenue - costs);
  }, { unit: "USD cents/60 days", description: "Simplified recognized sales minus modeled costs; no tax, inventory accounting or refunds" });
export const profitable = hypothesis("launch.profitable", { modeledProfit }, ({ modeledProfit }) => modeledProfit > 0);
export const movements = derive("launch.cash-movements", s.array(cashMovement),
  { orders, price, unitCost, overhead, collectionDay }, ({ orders, price, unitCost, overhead, collectionDay }) => [
    { id: "procurement", day: 0, amountCents: -orders * unitCost },
    { id: "customer-payment", day: collectionDay, amountCents: orders * price },
    { id: "overhead-30", day: 30, amountCents: -overhead },
    { id: "overhead-60", day: 60, amountCents: -overhead },
  ]);
export const cash = cashflow("launch.cash", { openingCash, horizonDay, movements }, "USD");
export const dna = model({ id: "cashflow-example", version: "0.1.0",
  values: [cash.fundingGap], checks: [profitable, cash.solvent] });
export const baseline = dna.scenario("two-orders")
  .set(orders, assumption(2, "Two hypothetical orders"))
  .set(price, assumption(100_000, "Hypothetical $1,000 order value"))
  .set(unitCost, assumption(40_000, "Hypothetical $400 upfront procurement per order"))
  .set(overhead, assumption(50_000, "Hypothetical $500 overhead on days 30 and 60"))
  .set(openingCash, assumption(150_000, "Hypothetical $1,500 opening cash"))
  .set(collectionDay, assumption(20, "Hypothetical collection on day 20"))
  .set(horizonDay, assumption(60, "Explicit 60-day planning horizon"));
export const growth = baseline.fork("double-the-orders")
  .set(orders, assumption(4, "Growth requires more upfront procurement"));
export const latePayment = baseline.fork("payment-after-the-horizon")
  .set(collectionDay, assumption(70, "Stress test: payment arrives after operating cash is needed"));
export const scenarios = [baseline];
