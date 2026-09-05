import { derive, hypothesis, type Infer, type Value, s } from "../index.ts";

const cents = s.number({ integer: true });
const nonnegativeCents = s.number({ integer: true, min: 0 });
const day = s.number({ integer: true, min: 0 });
export const cashMovement = s.object({
  id: s.string({ minLength: 1 }),
  day,
  amountCents: cents,
});
export type CashMovement = Infer<typeof cashMovement>;
const movementsSchema = s.array(cashMovement);
const ledgerSchema = s.array(s.object({
  id: s.string({ minLength: 1 }), day, amountCents: cents, balanceCents: cents,
}));

/** A bounded-horizon scenario, not accounting or a bank integration.
 * Events are cash transfers, NOT invoices or recognized revenue.
 * Day 0 and the horizon day are inclusive. Same-day outflows go first,
 * conservatively testing liquidity before that day's receipts clear.
 */
export function cashflow(id: string, inputs: {
  openingCash: Value<number>;
  horizonDay: Value<number>;
  movements: Value<readonly CashMovement[]>;
}, currency: "USD" | "EUR") {
  const ledger = derive(`${id}.ledger`, ledgerSchema, inputs,
    ({ openingCash, horizonDay, movements }) => {
      let balanceCents = nonnegativeCents.parse(openingCash, `${id}.openingCash`);
      day.parse(horizonDay, `${id}.horizonDay`);
      const parsed = movementsSchema.parse(movements, `${id}.movements`);
      if (new Set(parsed.map(item => item.id)).size !== parsed.length) {
        throw new Error(`${id}: duplicate cash movement IDs`);
      }
      const ordered = parsed.filter(item => item.day <= horizonDay).toSorted((a, b) =>
        a.day - b.day || a.amountCents - b.amountCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return ordered.map(item => {
        // Validate every intermediate addition: a later receipt cannot hide overflow.
        balanceCents = cents.parse(balanceCents + item.amountCents, `${id}.${item.id}.balance`);
        return { ...item, balanceCents };
      });
    }, { description: "Chronological modeled cash movements; same-day outflows precede receipts", unit: `${currency} cents` });
  const lowestBalance = derive(`${id}.lowest-balance`, cents,
    { openingCash: inputs.openingCash, ledger }, ({ openingCash, ledger }) =>
      ledger.reduce((minimum, entry) => Math.min(minimum, entry.balanceCents), openingCash),
    { unit: `${currency} cents` });
  const fundingGap = derive(`${id}.funding-gap`, nonnegativeCents, { lowestBalance },
    ({ lowestBalance }) => Math.max(0, -lowestBalance), { unit: `${currency} cents` });
  const solvent = hypothesis(`${id}.solvent`, { lowestBalance, ledger }, ({ lowestBalance, ledger }) => {
    const first = ledger.find(entry => entry.balanceCents < 0);
    return { status: lowestBalance >= 0 ? "pass" : "fail",
      message: first ? `First cash shortfall on day ${first.day}; required upfront buffer: ${-lowestBalance} ${currency} cents`
        : "No negative cash balance within the declared horizon and event schedule" };
  }, "Cash stays nonnegative throughout the declared planning horizon");
  return Object.freeze({ ledger, lowestBalance, fundingGap, solvent, currency });
}
