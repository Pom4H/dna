import { assumption, model } from "../src/index.ts";
import { subscription } from "../src/domains/commerce.ts";

// Fictional assumptions for API exploration, not a forecast or customer evidence.
export const business = subscription("example.studio", "USD");
export const dna = model({ id: "subscription-example", version: "0.1.0",
  entities: [business.account], checks: [business.unitEconomics, business.viable] });
const { customers, priceCents, variableCostCents, fixedCostCents } = business.account.fields;

export const baseline = dna.scenario("baseline")
  .set(customers, assumption(40, "Hypothetical paying customers"))
  .set(priceCents, assumption(10_000, "Hypothetical $100 monthly plan"))
  .set(variableCostCents, assumption(2_000, "Hypothetical $20 servicing cost per customer"))
  .set(fixedCostCents, assumption(250_000, "Hypothetical $2,500 monthly fixed costs"));

export const downside = baseline.fork("half-the-customers")
  .set(customers, assumption(20, "Sensitivity test: half the assumed customer count"));
export const breakEven = baseline.fork("exactly-break-even")
  .set(fixedCostCents, assumption(320_000, "Boundary test: zero margin is not positive margin"));

// The CLI checks only the selected baseline. Counterexamples remain executable tests.
export const scenarios = [baseline];
