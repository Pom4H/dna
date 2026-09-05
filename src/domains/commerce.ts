import { derive, entity, hypothesis, rule } from "../definitions.ts";
import { s } from "../schema.ts";

/** Simplified single-currency monthly contribution model. Taxes/churn/CAC are not modeled. */
export function subscription(id: string, currency: "USD" | "EUR") {
  const count = s.number({ integer: true, min: 0 });
  const cents = s.number({ integer: true, min: 0 });
  const account = entity(id, { type: "commerce.subscription", version: "0.1.0", fields: {
    customers: count, priceCents: cents, variableCostCents: cents, fixedCostCents: cents,
  } });
  const { customers, priceCents, variableCostCents, fixedCostCents } = account.fields;
  const revenue = derive(`${id}.revenue`, cents, { customers, priceCents },
    ({ customers, priceCents }) => customers * priceCents, { unit: `${currency} cents/month` });
  const cost = derive(`${id}.cost`, cents, { customers, variableCostCents, fixedCostCents },
    ({ customers, variableCostCents, fixedCostCents }) => customers * variableCostCents + fixedCostCents,
    { unit: `${currency} cents/month` });
  const margin = derive(`${id}.margin`, s.number({ integer: true }), { revenue, cost },
    ({ revenue, cost }) => revenue - cost, { unit: `${currency} cents/month` });
  const unitEconomics = rule(`${id}.unit-economics`, { priceCents, variableCostCents },
    ({ priceCents, variableCostCents }) => priceCents >= variableCostCents,
    "Price covers the modeled variable cost per customer");
  const viable = hypothesis(`${id}.viable`, { margin }, ({ margin }) => margin > 0,
    "Monthly revenue exceeds the explicitly modeled monthly costs");
  return Object.freeze({ account, revenue, cost, margin, unitEconomics, viable, currency });
}
