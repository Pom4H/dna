# Architecture

## A small domain kernel

DNA connects four distinct things: schemas of possible values, assertions about a specific scenario, executable business predicates, and evidence about the inputs. None substitutes for the others.

The dependency graph is explicit. A model discovers reachable facts/calculations from its checks and also registers declared entities/values. Fact and check IDs are global within a model. Shared references are allowed; two different definitions with the same ID are rejected. Cycles and check-as-value dependencies are rejected at compilation.

Entity `version` labels the vocabulary/schema version. Hardware revision or commercial offer version belongs in the entity identity or explicit facts. A global `User` object is not required: `access.user` is an authorization-context entity, not the universal shape of a human across CRM, employment and support.

## Evaluation

1. A scenario supplies assertions for facts. No assertion means unknown.
2. Runtime schemas validate and freeze input values. Derived outputs pass through schemas too.
3. `record` retains multiple assertions. Unequal validated JSON values produce a conflict; there is no implicit precedence or last-write-wins policy.
4. A report evaluates each reachable value once and caches it for that evaluation only.
5. Missing, conflicting or erroneous dependencies block downstream callbacks. Error takes precedence over conflict, which takes precedence over unknown; the underlying value results and input records remain available for inspection.
6. Predicates return booleans or synchronous verdicts. Truthy objects/strings and thrown errors do not pass.
7. Input provenance flows transitively. A hypothetical intermediate value never becomes an observation merely because a calculation succeeded.

A `set` is an explicit replacement within a new immutable scenario. Fork before replacing a disputed value to preserve both interpretations. This is snapshot branching, not a persistent event store or an approval workflow.

## Two different CI gates

The default gate asks whether all declared checks pass in the modeled scenario. A `conditional` hypothesis may pass this gate: its assumptions are visible and can be stress-tested.

The observations-only gate additionally requires every check to have observational input provenance. It intentionally rejects constants, assumptions and mixed inputs. It does **not** verify the truth of an observation label. Correlation, selection bias, scope mismatches, stale records, statistical power and causal identification need domain-specific measurement rules and external review.

`requireComplete` also rejects unresolved unused entity fields. Without it, an unrelated missing field does not invalidate an otherwise evaluable check. Every declared dependency of a callback is still mandatory, even if the function could short-circuit logically.

## Ordinary TypeScript, not AST magic

Use `if`, arrays and ordinary pure functions. Only dependency declarations become graph edges. Closures can capture hidden mutable state, time or network clients; DNA cannot make such code reproducible. Declare changing business inputs as facts and treat the checked-in implementation as part of the model specification.

Versioned descriptive IR contains schemas, IDs and edges, not serialized executable functions. Reconstructing execution from this JSON is intentionally unsupported. Impact analysis is conservative for the declared graph and says nothing about undeclared dependencies or whether a change is materially significant.

## Reusable domains

`usb`, `access`, `commerce` and `cashflow` are small illustrative factories. They have no special access to the engine. Each returns plain, frozen entity and/or calculation/check definitions. Compose factories through real TypeScript references. Instantiate with different IDs to avoid collisions.

The commerce example uses safe integer cents in a single chosen currency and period. Overflow is rejected at the output schema. Unit strings are documentation, not branded dimensional types; no FX conversion, rounding policy, tax, churn, refunds or acquisition-cost model is implemented. The separate cash-flow example supplies an explicit procurement/collection schedule; it is not a general working-capital or inventory-accounting system.

The firmware example describes an illustrative allow/deny calculation. It sends no command and is not a complete security boundary. Real operations need current authenticated identity, trusted device state, server-side checks, and protection against changes between check and execution.

## Cash-flow counterexamples

Cash movements are modeled separately from recognized revenue and cost. The reusable `cashflow` factory accepts typed opening cash, horizon and movement definitions; inputs may be facts or derived values. Day 0 and the horizon day are included. The ledger uses conservative outflow-first ordering within a day. Later receipts cannot retroactively remove an earlier deficit. Duplicate event IDs and unsafe intermediate integer arithmetic are errors.

A cash-solvency check says only that the supplied finite schedule remains nonnegative. It does not show survival after the horizon, the completeness of scheduled liabilities, collectability of receivables, availability of financing or accounting compliance. Every bundled input is synthetic and assumption-labeled.

## Toolchain and packaging

Bun 1.4.2 is pinned in `.bun-version`, `packageManager`, `engines` and CI. TypeScript 7.0.2 is pinned in dev dependencies. The native `tsc` typechecks and emits ESM plus declarations. The core has no runtime package dependencies and no Node/Bun imports; the CLI uses standard Node-compatible modules.

Source exports make this a Bun-first experimental repository dependency. `private: true` prevents accidental npm publication; it does not restrict the MIT license. The built entrypoint is smoke-tested, but publishing a packaged release and stable API are separate future steps.

## Changes worth experimenting with next

Test demand for typed entity references, domain package compatibility, units/quantities, evidence validity intervals and immutable dataset ingestion before adding them. Maintain separate tests for source quality, physical/product constraints and commercial hypotheses. Any learned business rule should arrive as an explicit code change plus a counterexample test, never as an invisible mutation of the model.
