# DNA

**Source-backed business models and cross-domain counterexamples in TypeScript.**

DNA experiments with connecting the same entities and facts across business decisions, software, documents and public promises. Existing systems remain authoritative. TypeScript describes relationships and checks; explicit snapshots make a particular evaluation reproducible.

The first question is not how many artifacts we can generate. It is: **when something changes, what should change with it — and what must stay unchanged?**

Experimental package **0.1.0**. TypeScript **7.0.2**, Bun **1.4.2**, MIT. Zero runtime dependencies in the modeling core. Not published to npm. The public contract's `dna: "1.0"` field is an experimental wire label, **not a stable or adopted standard**.

## Start with the experiments

```sh
git clone https://github.com/Pom4H/dna.git
cd dna
bun install --frozen-lockfile
bun run verify
bun run test:domains
bun run domains
```

`verify` typechecks source, examples, tests and negative type contracts; runs all tests; builds ESM and declarations; smoke-tests the built entrypoint; exercises the CLI; exports IR; and generates the cross-domain experiment report.

`domains` writes `reports/domain-stress/summary.json` and concrete JSON/Markdown previews. It includes intentionally failing business scenarios. **These are experiment previews, not deployment output, live integrations or publication approvals.**

## Four domains, different ways the model can break

All bundled inputs are fictional. The four examples read synthetic source snapshots rather than declaring a second editable catalog inside the model.

| Domain | Shared entities and output projections | Counterexample |
| --- | --- | --- |
| [SaaS](examples/cross-domain/saas.ts) | Offer, accepted subscription and request → pricing, billing line, API decision and support instructions | Changing today's offer must not reprice yesterday's accepted agreement. The same feature can be allowed for one tenant and denied for another. |
| [Professional services](examples/cross-domain/services.ts) | Service offer, accepted scope and staffing → website data, proposal, work order, schedule check and invoice candidate | An advertised service does not reserve capacity. Changing the catalog must not rewrite agreed deliverables. |
| [Media publishing](examples/cross-domain/publishing.ts) | Asset, permission and distribution context → web placement, social placement, archive reference and runbook | Permission depends on revision, market, channel and time. Revocation blocks distribution without deleting the original asset. |
| [Reservations](examples/cross-domain/reservations.ts) | Workshop slot, inventory snapshot, request and reservation record → listing, search result, reservation intent and confirmation | Two requests can both pass against the last-seat snapshot. Only the inventory authority can atomically accept one reservation. |

There are **14 exported scenarios and 17 surface definitions** across these examples. Tests assert both propagation and non-propagation. The bounded SaaS policy sweep covers 32 combinations; it is not a proof over arbitrary inputs.

**Result so far:** the explicit dependency/snapshot kernel is reusable across these cases. The product-shaped public contract is not expressive enough to exchange their contextual meaning without losing information.

Read the [cross-domain findings](docs/cross-domain-findings.md) before extending the protocol.

## A change that must not propagate everywhere

This code uses the checked-in SaaS example:

```ts
import assert from "node:assert/strict";
import { baseline, repriced, pricing, billing, canInvite, business, offer }
  from "./examples/cross-domain/saas.ts";

// A new public offer changes pricing output.
assert.notDeepEqual(baseline.read(pricing), repriced.read(pricing));

// It does not silently change an existing accepted subscription.
assert.deepEqual(baseline.read(billing), repriced.read(billing));
assert.deepEqual(baseline.read(canInvite), repriced.read(canInvite));

assert.deepEqual(business.impact(offer.fields.monthlyCents), [pricing.id]);
```

This is not solved by synchronizing one global `price` field everywhere. An offered price and an agreed price are **different facts with different authorities and lifecycles**. Shared identity does not mean every context shares one mutable object.

## What the kernel does

| Primitive | Meaning |
| --- | --- |
| `s.*` | Runtime schemas with inferred TypeScript types; strict objects, no coercion or hidden defaults |
| `entity` / `fact` | Identities and typed knowledge slots; declaring a slot does not mean its value is known |
| `assumption` / `observation` | Explicit input provenance; an observation label is a caller assertion, not authenticated evidence |
| `derive` | Synchronous computation over explicitly declared dependencies |
| `rule` / `hypothesis` | Modeled invariant / falsifiable predicate |
| `scenario` | Immutable supplied state; fork before exploring another possibility |
| `artifact` | A deterministic output projection with dependency tracing; does not deploy or write files itself |
| `impact` | Conservative transitive dependants of declared inputs, not arbitrary code-change analysis |

Use ordinary `if` statements and functions. There is no custom parser, decorator transform, database, global registry or required AI service.

```ts
import { assumption, derive, fact, model, rule, s } from "./src/index.ts";

const required = fact("engagement.required-hours", s.number({ min: 0 }));
const free = fact("staffing.free-hours", s.number({ min: 0 }));
const feasible = derive("delivery.feasible", s.boolean,
  { required, free }, ({ required, free }) => free >= required);

const delivery = model({ id: "delivery", version: "1", checks: [
  rule("delivery.has-capacity", { feasible }, ({ feasible }) => feasible),
] });

const scenario = delivery.scenario("overcommitted")
  .set(required, assumption(12, "Synthetic engagement estimate"))
  .set(free, assumption(4, "Synthetic staffing snapshot"));

scenario.evaluate().ok; // false; a useful counterexample, not a broken test suite
```

A missing value stays `unknown`. Conflicting assertions stay `conflict`. Exceptions produce `error`. A hypothesis based on assumptions remains `conditional`, even when its predicate passes.

## Sources, snapshots and authority

**DNA describes relationships; it does not make itself the owner of business records.**

A price can come from a billing catalog; an agreed fee from an accepted engagement; permission from a rights register; remaining inventory from a reservation service. An adapter should validate source data outside pure calculations, record its identity/version and produce a reproducible evaluation snapshot.

The [fixture adapter](examples/cross-domain/snapshots.ts) demonstrates this with read-only JSON files and SHA-256 digests. Changing an upstream file changes a fresh evaluation without changing the model declarations; the previous scenario remains intact. All these inputs stay labeled synthetic assumptions.

This adapter is **not** an ERP, payment-provider or calendar integration. A digest detects which bytes were used; it does not authenticate their publisher or prove their meaning. A snapshot is an intentional copy for evaluation/replay, not a competing editable source of truth.

## Important failures, not hidden behind green CI

[`tests/known-gaps.test.ts`](tests/known-gaps.test.ts) contains executable **characterization tests**. They pass when a limitation is reproduced, not when it has been solved:

- `claim()` and `publication()` register dependencies but do not enforce an approval predicate. A renderer can ignore a false approval input. Reading an artifact does not assert the model's release checks.
- Observation timestamps and scopes are recorded but not automatically checked for freshness or relevance. Observations about different periods are not a time-series engine.
- Unit metadata does not enforce currency/dimensional arithmetic. All callback dependencies are resolved eagerly, even when a JavaScript branch could short-circuit.
- The public contract cannot express actor/time/market qualifiers or domain-namespaced relations. Internal scenario/report exports are not safe public projections.

The reservation tests additionally demonstrate why a successful snapshot check is not a transaction. Actual reservations and authorization must be enforced by their authoritative runtime systems.

**A green suite does not certify the model of the world, a permission, a product, a business opportunity or these unresolved semantics.**

## Public contracts: a hypothesis under test

The goal remains a deliberately limited, machine-readable projection that another company or tool can consume without importing private executable TypeScript.

The existing prototype provides:

- `contract()` for strict shape and reference validation;
- `discovery()` for a proposed discovery document;
- `semanticDiff()` for declared changes to the contract envelope, authorities, entities, capabilities, claims and relations.

See [the original public-contract example](examples/public-contract.ts). The proposed `/.well-known/dna` path is not a registered discovery standard, and no registry, crawler or marketplace is implemented here.

Cross-domain testing found and fixed seven structural/diff defects: global identity collisions, invalid capability subjects, self-citing evidence, duplicate edges, invisible authority changes, invisible publisher/revision changes, and false changes from evidence-reference order. Evidence now references an authority; this is still only a reference, not approval or proof.

`semanticDiff` is **not** a compatibility solver or an automatic breaking-change classifier. A changed authority URL is visible; changed bytes behind the same URL are not discovered by this function.

The public wire shape has not been inflated to accommodate every case yet. Flattening a contextual permission or a live reservation into `status: "available"` would discard meaning. A registry built over that loss would amplify the mistake.

## Executing a fictional company network

The [company-network demo](examples/company-network/README.md) connects this kernel to Workflow SDK 4.8.5. Three company processes exchange signals, await acceptance and reconcile a repeated inventory operation against an authority receipt. A versioned UI IR feeds two shells and two themes; a synthetic device passport links components to actual simulated operation receipts. A separate constrained search compares seven future offers without changing the accepted agreement.

Run `bun install --frozen-lockfile` and `bun run demo:network` with Bun 1.4.2, then open `http://127.0.0.1:3117`. `bun run verify:network` exercises the actual SDK and process restart in an isolated directory. This is a localhost example with fictional funds and playable company roles; it does not authenticate real companies or implement distributed transactions. The [larger business specification](docs/business-model/README.md) describes assumptions beyond the implemented slice.

## Earlier examples

The earlier [product thread](examples/product-thread.ts) and [product DNA](examples/product-dna.ts) explore shared facts across firmware configuration, application capabilities, engineering diagrams, documents and claims. They remain useful examples, not the template every domain must follow.

The existing `problem`, `capability`, `claim` and `publication` helpers are thin constructs over computed values. They do not establish a universal ontology or a fully connected rationale graph. In particular, **a rationale relationship is not automatically an executable data dependency**.

[Subscription arithmetic](examples/subscription.ts), [cash-flow counterexamples](examples/cashflow.ts), [pilot decision rules](examples/pilot.ts) and [firmware authorization modeling](examples/firmware.ts) remain available as smaller experiments.

## Repository map

```text
examples/cross-domain/       four source-backed, non-hardware experiments
examples/cross-domain/fixtures/  synthetic upstream snapshots
scripts/stress-domains.ts    materialize previews and compare actual output changes
tests/cross-domain.test.ts   propagation, non-propagation and bounded scenario checks
tests/known-gaps.test.ts     intentionally exposed limits, not implemented promises
tests/contract-regressions.test.ts  reproduced defects with regression coverage
docs/cross-domain-findings.md      results and design implications
src/model.ts                evaluation, snapshots, provenance and impact
src/contract.ts             experimental public wire validation and diff
src/semantics.ts            early semantic wrappers
src/artifacts.ts            output projections
```

[Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [Agent guide](AGENTS.md)

## How the experiment should earn another abstraction

Keep a concrete input, a decision, at least two consuming surfaces and a counterexample. Check which outputs must change and which must not. Show where the authority lives. Compare against plain functions and tests before claiming that DNA reduces work.

Do not build a registry or declare a stable universal protocol before contextual meaning can survive export/import. Do not turn inventory transactions, legal interpretation, causal inference or evidence authentication into boolean labels and call the problem solved.

The present results support continued experiments with a small modeling kernel. They do not yet establish lower maintenance cost, production adoption or a general standard.

## License

MIT. `private: true` prevents accidental npm publication; it does not restrict the open-source license.
