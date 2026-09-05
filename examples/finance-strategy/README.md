# Financial model, business rules, and strategy choices

This experiment asks whether one decision model can connect a company's choice of customers and allocation of scarce time to deal admission, commercial terms, delivery obligations, financial projections, and strategy review. It uses existing DNA primitives. No generic `strategy()` framework, accounting engine, optimizer, or new wire format is introduced.

All data is fictional. `sources.json` is a read-only stand-in for accepted agreements, CRM opportunities, capacity and a treasury schedule. `decision.json` is a separate, explicit management-policy snapshot. Both are read via the existing content-digested fixture adapter. These files are test inputs, not connected business records; every result remains conditional.

## What had been tested before

The earlier subscription example checked unit contribution, break-even, sensitivity and integer overflow. The cash-flow example checked profit versus cash, collection timing, event order and horizon boundaries. Cross-domain examples checked offer-versus-agreement and several operating policies. They did not test an integrated strategic choice, allocation of resources, and a reconciled financial projection together.

## The model

- **Choice:** pursue repeatable engagements or any segment; rank opportunities by direct contribution or revenue; reserve time instead of selling all available hours.
- **Admission policy:** enforce contribution and deposit floors. Return every applicable refusal reason. Existing accepted agreements are not silently re-admitted under new rules.
- **Portfolio guardrails:** preserve cash and capacity buffers, and limit customer concentration by total accepted/planned fees.
- **Financial projection:** use the same order identities, terms and dates for revenue, expenses, collections, advances, receivables and cash.
- **Objective:** compare projected profit to a stated target. The target is not an input to revenue or demand.
- **Review:** a missed target asks for reviewing assumptions or the plan. It does not automatically invent sales, relax a rule, or alter reality.

The selection algorithm is deterministic greedy ranking, **not optimization**. It checks local admission rules and shared capacity, then evaluates portfolio-level cash/concentration constraints. A rejected portfolio remains visible; the program does not assert that a feasible portfolio has been found.

The resulting six projections are website offer data, candidate proposals, accepted work, capacity allocation, a finance report and a strategy review. They are small JSON previews, not deployed applications. Changing the choice affects several surfaces; changing a profit goal affects only the goal check and strategy review; changing a new-deal policy never rewrites accepted work.

## Explicit toy accounting policy

Currency is USD in integer cents. Revenue is recognized at the full-delivery date. Direct costs and overhead are expensed and paid on their scheduled dates. Pre-delivery receipts are deferred revenue. Delivered but uncollected consideration is a receivable. Loan principal changes debt and cash, not revenue or expense. Deposits round down to cents; the remainder preserves the full fee. BigInt intermediates avoid rounding/overflow in integer totals and basis-point calculations.

Opening cash is funded by opening equity; opening receivables, payables, debt and deferred revenue are zero. There is no partial-delivery accounting, inventory, capitalization, depreciation, tax, VAT, interest, refunds, bad debt, FX, new equity, revenue-recognition standard compliance or full general ledger. In particular, expensing all direct costs on the cost date is a stated modeling choice, not a universal accounting prescription.

At any chosen horizon:

```text
cash + receivables = deferred revenue + debt + opening equity + accumulated profit
```

This identity is tested at all 91 day boundaries in three scenarios, alongside independent expected amounts. Reconciliation does **not** imply feasibility: a negative projected cash position remains an unfunded plan, not an implicitly available overdraft. Within-day cash outflows precede receipts, inherited from the existing cash-flow domain.

## Reproducible synthetic outcomes

Opening cash: $2,000. Horizon: day 0 through day 90 inclusive. One already-accepted job remains in every scenario. The two repeatable opportunities and one larger custom opportunity are assumed to convert if selected, except in the explicit no-conversion stress. No sales probability has been estimated.

| Scenario | Revenue | Profit | Lowest cash | What it exposes |
| --- | ---: | ---: | ---: | --- |
| Repeatable focus, 50% deposits | $8,000 | $2,200 | $1,200 | Passes these illustrative goals and guardrails under the base inputs |
| Revenue-first, lower admission floors | $12,000 | $1,200 | -$6,800 | Higher revenue is not the same objective as profit or liquidity; concentration also fails |
| Repeatable focus, remainders 60 days late | $8,000 | $2,200 | -$800 | Profit goal passes while the cash guardrail fails; $3,000 remains receivable at day 90 |
| Same plan, profit target raised to $5,000 | $8,000 | $2,200 | $1,200 | An aspiration changes the review, not the projection |
| No new opportunity converts | $2,000 | -$1,800 | $200 | Old obligations and overhead survive the disappearance of forecast sales |

The reporter also applies the same delay and no-conversion shocks to the revenue-first alternative. Neither choice passes all the modeled shocks. The comparison does not establish that either strategy is optimal, that repeatable work creates demand, or that the modeled direct costs follow causally from specialization.

## Tests

```sh
bun test tests/finance-strategy.test.ts
bun run finance
```

`finance` writes an internal preview bundle to `reports/finance-strategy/`, including a summary, source-traced scenario reports, the dependency IR and six projections for each of seven scenarios. Infeasible plans are intentionally rendered for analysis; no preview is permission to publish, accept work, reserve staff or move money. The command asserts expected gate outcomes and fails on unexpected errors.

Useful invariants include:

```ts
import assert from "node:assert/strict";
import { baseline, ambitiousTarget, statements, obligations, revenueFirst, business, target }
  from "./model.ts";

// Raising a goal does not manufacture a better forecast.
assert.deepEqual(baseline.read(statements), ambitiousTarget.read(statements));
assert.deepEqual(business.impact(target), ["strategy.profit-goal", "surface.strategy-review"]);

// Replacing strategy/new-deal rules cannot change already-accepted work.
assert.deepEqual(baseline.read(obligations), revenueFirst.read(obligations));
```

Additional cases cover deposits before delivery, principal draw/repayment, funding arriving too late, concentration, contested capacity, all refusal reasons, impossible thresholds, no demand, duplicate source IDs, invalid timelines, exact rounding, currency rejection, missing inputs, overflow, 27 policy combinations, and daily reconciliation. These finite sweeps are not exhaustive proofs.

## What breaks or remains unproven

**Strategy is not a target and not merely a list of constraints.** This example represents part of a strategy: where to play, what to prioritize, and how to allocate scarce capacity. It does not infer an advantage, competitive response, customer willingness to pay or the causal effect of investment. Reserved hours have an opportunity cost here, but their future payoff is deliberately unknown rather than fabricated.

**A demand assumption is not a sale.** All selected leads becoming contracts is optimistic by construction. A no-conversion counterexample is included. Probability calibration, funnel stages, correlated defaults, cohorts, churn, CAC/LTV and out-of-sample validation remain unimplemented.

**A positive margin does not make a deal admissible.** Local rules can all pass while shared capacity or portfolio cash/concentration makes the plan unacceptable. Conflicting rules are reported as multiple refusal reasons or an infeasible portfolio; priorities, exceptions and approvals are not solved by the kernel.

**Dates and states matter.** A prepayment, a delivered service, an invoice balance and collected cash refer to the same commercial relationship but are not interchangeable facts. Accepted terms and current offering policy have different owners. The simplified model is not suitable for financial decisions without a real accounting policy and reconciled authoritative inputs.

**The DAG is coarser than the financial semantics.** `finance.statements` is one aggregate calculation: a collection-date change re-evaluates the report although numeric revenue is unchanged. The tests assert this non-change in values; `impact()` alone does not infer it. Array facts also have collection-level edges; individual order identities are retained in data, not registered as separate graph entities.

**Portability has not been solved.** The public DNA contract still cannot transport these scoped policies, numeric values and executable rules losslessly. This experiment does not fix the eight earlier known gaps, implement a stable strategy vocabulary, or justify a registry.

The result is a tested ability to state concrete decisions and seek counterexamples **under explicit assumptions**, not a tested ability to discover a winning business strategy. No new core API was needed to demonstrate it.
