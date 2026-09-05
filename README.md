# DNA

**Executable domain models and hypothesis tests in ordinary TypeScript.**

Declare what a business or product consists of, what you know about it, which rules must hold, and what would falsify an assumption. Reuse small domain libraries across models. Run scenarios with Bun.

Experimental **0.1.0**. TypeScript **7.0.2**, Bun **1.4.2**. Zero runtime dependencies in the core. MIT licensed. The package is not published to npm; `@pom4h/dna` is its local package identity.

## Try it

Install Bun 1.4.2, then:

```sh
git clone https://github.com/Pom4H/dna.git
cd dna
bun install --frozen-lockfile
bun run verify
bun run demo
```

`verify` typechecks source, examples, tests and negative type contracts; runs the tests; builds ESM/declarations; checks the built entrypoint; evaluates the example model; and exports JSON IR/reports.

## A hypothesis you can break

```ts
import { assumption, derive, fact, hypothesis, model, s } from "./src/index.ts";

const customers = fact("customers", s.number({ integer: true, min: 0 }));
const price = fact("price", s.number({ integer: true, min: 0 }), {
  unit: "USD cents/customer/month",
});
const revenue = derive("revenue", s.number({ integer: true, min: 0 }),
  { customers, price }, ({ customers, price }) => customers * price);

const costs = fact("costs", s.number({ integer: true, min: 0 }), {
  unit: "USD cents/month",
});
const coversCosts = hypothesis("covers-costs", { revenue, costs },
  ({ revenue, costs }) => revenue > costs,
  "Revenue exceeds the explicitly modeled monthly costs");

const business = model({
  id: "example", version: "0.1.0", checks: [coversCosts],
});

const baseline = business.scenario("baseline")
  .set(customers, assumption(40, "Proposed customer count"))
  .set(price, assumption(10_000, "Proposed $100 monthly price"))
  .set(costs, assumption(250_000, "Proposed $2,500 monthly cost"));

baseline.evaluate().assert(); // Passes inside this model; conclusion is conditional.

const downside = baseline.fork("half-the-customers")
  .set(customers, assumption(20, "Sensitivity scenario"));

downside.evaluate().assert(); // Throws: covers-costs failed.
// The baseline is unchanged. Failed scenarios are useful counterexamples.
```

Declare changing costs as facts rather than hiding them in closures. The fuller [subscription example](examples/subscription.ts) uses a reusable [commerce domain](src/domains/commerce.ts) with variable/fixed costs and integer minor-unit arithmetic.

## More profitable can still run out of cash

The [cash-flow example](examples/cashflow.ts) connects the same orders and costs to both a profit hypothesis and a timed cash ledger:

| Fictional scenario, 60-day horizon | Modeled profit | Lowest cash balance | Cash hypothesis |
| --- | ---: | ---: | --- |
| Two orders, paid on day 20 | $200 | $700 | Pass, conditional |
| Four orders, paid on day 20 | $1,400 | -$100 | Fail, conditional |
| Two orders, paid on day 70 | $200 | -$300 | Fail, conditional |

Growth requires procurement before receipts. A late receipt is not cash available today. The [reusable cash-flow domain](src/domains/cashflow.ts) sorts events, handles the horizon boundary, detects duplicate IDs and integer overflow, and reports a required upfront buffer. Same-day outflows are conservatively processed before receipts; it is not a bank statement or a full accounting model.

```ts
import { growth, cash } from "./examples/cashflow.ts";

const report = growth.evaluate();
report.checks.find(check => check.id === "launch.profitable")?.status; // "pass"
report.checks.find(check => check.id === cash.solvent.id)?.status;    // "fail"
growth.read(cash.fundingGap); // known, 10_000 USD cents, assumptions
```

[Why model counterexamples before automating processes](docs/model-before-automation.md).

## Types, facts, rules, hypotheses

| Primitive | Meaning |
| --- | --- |
| `s.*` | Runtime validation with inferred TypeScript types; no coercion or hidden defaults. |
| `fact(id, schema)` | A named slot for knowledge, not a claim that its value is known. |
| `entity(id, { type, version, fields })` | A stable identity with namespaced typed fact fields. |
| `derive(id, schema, deps, fn)` | A typed synchronous calculation over declared dependencies. |
| `rule(id, deps, fn)` | A requirement or invariant the modeled scenario must satisfy. |
| `hypothesis(id, deps, fn)` | A falsifiable predicate, with an explicit evidence basis. |
| `assumption(value, reason)` | An input used to explore a possible world. |
| `observation(value, { source, at, scope })` | A caller-declared observation with traceable provenance. |
| `inconclusive(reason)` | Refuse a conclusion, for example because a sample is too small. |

Schemas are intentionally small: finite numbers, safe integers, booleans, strings, enums, arrays and strict objects. All object fields are required. Missing knowledge belongs to the fact layer, not to a silent schema default.

## Cross-domain entities: a user and a USB-C port

[The firmware example](examples/firmware.ts) composes the `access` and `usb` libraries with a product-specific device entity. Authorization uses ordinary `if` statements:

```ts
const allowed = derive("firmware.allowed", s.boolean, {
  active: actor.fields.active,
  role: actor.fields.role,
  data: port.fields.data,
  feature: device.fields.firmwareUpdate,
}, ({ active, role, data, feature }) => {
  if (!active || role === "operator") return false;
  if (!feature || data === "none") return false;
  return true;
});
```

This excerpt omits tenant and maintenance-mode checks; the complete example includes them. A USB-C connector does **not** automatically imply a data protocol, Power Delivery, or a firmware-update feature. The USB module is an illustrative vocabulary, not an implementation of the USB specifications or a compliance validator.

Factories create ordinary entities and definitions; there is no global registry, decorator transform, custom language, ORM, database or AI service.

## Unknown is not false

A value is `known`, `unknown`, `conflict`, or `error`. A check is `pass`, `fail`, `unknown`, `conflict`, or `error`.

```ts
const pending = business.scenario("no-data");
pending.read(revenue).status; // "unknown"
pending.evaluate().assert();  // Throws, never silently passes.

const conflicted = baseline.record(customers,
  assumption(5, "A conflicting estimate"));
conflicted.read(customers).status; // "conflict"
```

`set()` explicitly replaces a fact's assertions. `record()` appends evidence and detects conflicting values. `fork()` preserves a parent scenario before deliberate replacement. Inputs are validated, copied and frozen. Matching assertions from several sources keep their provenance; an observation does not silently erase an assumption.

## A passing test is not market evidence

Every conclusion carries its transitive `origins` and `basis`: `assumptions`, `observations`, `mixed`, or `none`.

| Hypothesis result | Conclusion |
| --- | --- |
| Pass/fail with assumptions, mixed inputs, or no inputs | `conditional` |
| Pass using only declared observations | `supported` on the supplied data |
| Fail using only declared observations | `refuted` on the supplied data |
| Missing/conflicting/erroring inputs or insufficient sample | `inconclusive` |

```ts
baseline.evaluate().assert({ requireObservations: true });
// Throws because the baseline uses assumptions.
```

`requireObservations` checks provenance **labels**, not source authenticity, causality, sample quality, or truth. Callers can mislabel fabricated inputs. Correct experiment design and genuine measurements remain your responsibility.

[The pilot example](examples/pilot.ts) demonstrates a predeclared decision rule, paired timings, a minimum sample count, duplicate-ID detection, and inclusion of correction effort. Its bundled data is explicitly synthetic. The threshold is illustrative, not a statistical significance test or a real customer result.

## Tests are the working interface

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseline, downside } from "./examples/subscription.ts";

test("baseline satisfies the modeled constraints", () => {
  baseline.evaluate().assert();
});

test("fewer customers falsify the viability hypothesis", () => {
  const result = downside.evaluate().checks.find(c => c.kind === "hypothesis");
  assert.equal(result?.status, "fail");
  assert.equal(result?.conclusion, "conditional");
});
```

The suite uses the standard `node:test`/`node:assert` APIs under `bun test`. It includes negative type contracts, numerical boundaries, exhaustive bounded policy/sensitivity sweeps, evidence conflicts, source tracing, unknown propagation and CLI exit-code tests. Bounded sweeps are not proofs over all inputs or a property-testing engine with shrinking.

## CLI and reviewable artifacts

Model modules export a non-empty `scenarios: Scenario[]` array.

```sh
bun src/cli.ts examples/subscription.ts
bun src/cli.ts examples/subscription.ts --json
bun src/cli.ts examples/subscription.ts --observed  # Intentionally exits 1
bun src/cli.ts examples/firmware.ts --complete
bun src/cli.ts examples/cashflow.ts
bun run ir
```

Exit codes: **0** selected gates pass; **1** a scenario gate fails (including unknown/conflict/error); **2** usage, import or module-shape error. JSON separates ordinary model results from the selected strict gate outcomes. An empty check suite cannot pass.

`model.toJSON()` exports identities, schemas, explicit dependency edges, descriptions and version labels. `scenario.toJSON()` and `report.toJSON()` include assertions/provenance. `model.impact(changedFact)` lists transitive dependants.

**IR is descriptive, not executable.** Functions stay in TypeScript. Commit code, domain versions, lockfile and scenarios together for review/replay. The model version is a caller-managed label, not a content hash. An impact query follows declared edges, not arbitrary code edits or hidden closure captures.

## Boundaries

DNA imports and executes **trusted code only**. It is not a sandbox for unreviewed agent output. Keep callbacks pure and synchronous; inject time, rates, measurements and policies as facts. The engine cannot enforce purity or discover undeclared dependencies. Every declared input is resolved before a callback runs, even when a JavaScript branch might not need it.

This prototype does not authenticate evidence, align periods/scopes automatically, certify hardware, perform real authorization against a live service, enforce dimensional analysis, provide ACID transactions, infer business rules, prove a market opportunity, or serialize arbitrary JavaScript into an executable graph. Reports may contain sensitive model inputs; do not publish them blindly.

[Architecture and design decisions](docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [Agent guide](AGENTS.md)

## References

- [TypeScript 7 release and native `tsc`](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Bun 1.4.2 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)
- [Bun's `node:test` compatibility](https://bun.com/docs/runtime/nodejs-compat)
- [USB-IF: USB Type-C terminology](https://www.usb.org/usb-type-cr-cable-and-connector-specification)
