# Business evolution experiment

This is a fictional market laboratory, not empirical validation or financial advice. Run `bun run evolve:business` with Bun 1.4.2. Full candidate genomes, parent IDs and fitness are written to `reports/business-evolution/full.json`; compact results go to `summary.json`.

The experiment evolves a company's commercial and operating policy: channel, purchase versus service, entry price, recurring price, deposit, installation hours, component, support and (since v2) cash reserve before accepting new installations. Every candidate competes with three fictional rival policies for the same buyers, monthly kit stock and installer hours. Rival policies are fixed; their cash, customers and reputation change. This is not an equilibrium or coevolution of all players.

Buyer reach, utility, price sensitivity, liquidity, incidents and cancellation are explicit synthetic assumptions in `examples/business-evolution/model.ts`. Contract terms are immutable snapshots. Revising an offer affects only later cohorts. Each market has 12 acquisition months followed by 12 runoff months; all accepted service and collection schedules finish before scoring. Cash is tracked per movement, including acquisition, kit and installation payments before future subscription receipts, fixed costs, service costs and credits. There is no terminal valuation or assumed hardware resale.

DNA gates require at least six installation hours, nonnegative minimum cash, no resource overdraw and no unfinished modeled obligations. Missing outcomes produce unknown decisions. The fixed objective, after these gates, is `0.5 × mean net cash + 0.5 × worst net cash` across training markets (six in v1, eight in v2). This weighting is a design choice, not an estimated risk preference. A nonnegative cash path can still end with an operating loss.

Search uses uniform crossover, mutation of at least one locus, an archive of distinct elites and 25% random immigrants. Three optimizer seeds each receive 96 new candidates × 12 generations. A random search receives the same number of evaluations and the same training worlds. Counter-based draws keep exogenous customer events aligned across policy comparisons. Held-out markets are evaluated only after training selection. Four stronger scenario changes are reported separately and cannot pick the winner.

## First experiment

The eight-gene model evaluated 6,912 strategy trials across evolutionary and random search, or 41,472 training-market simulations. Each market contains four company trajectories; the trials are alternative fictional companies, not thousands of real businesses. Genetic runs converged to the same policy: partner channel, service, EUR 720 entry charge, EUR 360 monthly, zero deposit, six installation hours, rugged component, lean support. Mean training net cash was EUR 95,839.60. All three genetic winners failed solvency on held-out seeds despite positive mean final net cash of EUR 64,100.40. All three random-search winners (two distinct policies) also failed held-out solvency. The baseline had mean held-out net cash of EUR −52,266.67.

This exposed a missing business intervention: admission control for new installations. Funding a kit today is insufficient if the remaining cash cannot cover tomorrow's fixed costs. The failed result is retained in Git commit `ef28cf2` and `business-evolution-v1-results.json`. It motivates a new model version, not promotion of the first winner.

## Second experiment and protection against evaluation leakage

Version 2 adds a reserve of 0, 1 or 3 months of fixed and currently committed recurring service costs. The reserve is checked before accepting a new installation; it does not cancel or reprice existing contracts. It is a conservative admission heuristic, not a mathematical guarantee of survival against every possible incident.

The two failed v1 evaluation worlds (seeds 1009 and 1103) become explicit training counterexamples. The entire old holdout set is now development evidence. Six previously unused seeds (2003, 2111, 2203, 2309, 2411, 2503) form the final evaluation set. The optimizer does not read their outcomes. Four stress worlds are scenario diagnostics already known from v1, not fresh validation. No result here estimates real-world generalization or statistical significance.

The nine discrete loci define exactly 6,912 combinations. In addition to the two heuristic searches, `exhaustiveSearch` evaluates every combination on training worlds, applies the same DNA gates and scores, and evaluates the selected policy on the same final holdout. Its result is an exact optimum **only inside this finite grid and fixed objective on these training worlds**. It does not prove a local or global optimum in business reality, continuous prices, unrestricted TypeScript or other market assumptions.

## Version 2 results

The complete experiment evaluated 13,824 strategy trials, including the full 6,912-policy grid, across 110,592 training-market simulations. Of the complete grid, 1,237 policies passed every training gate. Each genetic or random run received 1,152 trials; evolutionary runs visited 894, 864 and 915 distinct policies, while random runs visited 1,065, 1,063 and 1,062. All three evolutionary runs selected the same finite-grid optimum; all three random runs selected another policy. Three seeds are a small algorithm comparison, not a statistical guarantee of success rates. Recorded results are in [business-evolution-results.json](business-evolution-results.json).

Figures below are EUR, over the fixed 24-month schedule. Net cash means final cash minus opening cash; it is not accounting profit. Opening capital in the final evaluation worlds is EUR 40,000.

| Policy | Training objective | Mean final-evaluation net cash | Worst final-evaluation net cash | Lowest cash anywhere in final evaluation | All final-evaluation gates |
| --- | ---: | ---: | ---: | ---: | --- |
| Initial baseline | −63,023.75 | −53,698.33 | −74,510.00 | −34,510.00 | Fail |
| Equal-budget random search winner | 84,715.35 | 91,923.87 | 63,370.40 | 7,602.40 | Pass |
| Evolution / full-grid winner | 86,145.80 | 96,116.80 | 70,390.40 | 2,329.60 | Pass |

The selected policy uses a partner channel, a service arrangement with EUR 720 entry charge and EUR 360 monthly, 50% deposit on the entry charge, six installation hours, rugged components, staffed support and a one-month admission reserve. The entry-price locus is EUR 3,600; service mode explicitly converts it to a one-fifth setup charge. The entire EUR 3,600 is not charged in service mode. Monthly price is at the grid's upper boundary: the experiment does not establish that EUR 360 is an optimum outside the supplied price choices.

The initial policy is direct sales at EUR 3,000 plus EUR 150 monthly, a 50% deposit, eight hours, standard components, staffed support and no reserve. Synthetic buyers' budgets, willingness to pay and reach assumptions strongly favor different market access in this experiment. These are hypotheses to test with evidence, not validated pricing recommendations.

The genetic winner improves the training objective by only **1.69%** over the random winner and final-evaluation mean net cash by **4.56%**, while keeping a smaller minimum cash buffer. Random search is already competitive. The two policies also expose a tradeoff: the random winner chooses lean support and a three-month reserve, and fares better in the supplied supply and credit stress cases. An optimizer maximizing this scalar objective does not automatically maximize resilience.

| Stress world, already known from v1 | Selected policy net cash, EUR | Minimum cash, EUR | Gates |
| --- | ---: | ---: | --- |
| Rivals reduce prices by 35% | 24,224.00 | 2,613.60 | Pass |
| Scarcer kits/hours, kits cost 50% more | 4,539.20 | 796.80 | Pass |
| Half as many buyers, modeled benefit 30% lower | −36,417.60 | 3,582.40 | Pass, but loses capital |
| Half the opening capital, lower buyer liquidity, six-month collection delay | −56,523.20 | −36,523.20 | Fail |

These failures remain visible. Passing six fresh synthetic scenarios does not authorize operational rollout. More meaningful next interventions include cash-dependent acquisition spending and financing arrangements; their assumptions and effects would need separate tests. Keeping several policies with different cash/profit/resilience tradeoffs is preferable to presenting one scalar winner as the universally best business.

## Mathematical structure

For policy `g`, scenario seed and assumptions `ω`, state `x` and immutable accepted-contract set `C`, the simulator implements `x[t+1] = F(x[t], g, C, ω[t])`. Buyer choices, rival cash, service incidents and resource consumption are state transitions. Revising `g` changes later offers; each previously accepted member of `C` keeps its own terms. The customer incident and cancellation paths also affect future subscription receipts and reputation, creating a modeled feedback loop.

The search solves a finite constrained policy problem: first satisfy all declared invariants for every training world, then maximize `J(g) = (meanω Δcash(g,ω) + minω Δcash(g,ω)) / 2`. Elite retention is monotone in that **lexicographic** ordering: becoming feasible can lower the numerical score while improving rank. The minimum is a worst scenario in the supplied set, not a probability tail estimate. Search randomness and market randomness have separate seeds.

The genome is an intervention vocabulary, not a universal representation of an organization. Adding the reserve locus changes what business designs can be expressed; searching more generations inside the old vocabulary could never discover that policy. This is the useful division of work with agents: agents can propose an explicit new intervention or challenge a simulator assumption, while deterministic evaluation rejects counterexamples and measures consequences. Such changes must preserve the assessment rules or make any proposed rule change separately reviewable.

## Files and reproduction

- `examples/business-evolution/model.ts`: validated policies, fictional market transitions, cohort snapshots and DNA gates.
- `examples/business-evolution/search.ts`: mutations, parent lineage, random control and complete finite enumeration.
- `scripts/evolve-business.ts`: fixed experiment, source SHA-256 hashes, reports and held-out cohort traces.
- `tests/business-evolution.test.ts`: liquidity, quality, cohort preservation, shared resources, terminal obligations, unknown results, reproducibility and holdout isolation.
- `reports/business-evolution/full.json`: all trials including duplicate genomes and their parent IDs; duplicate evaluations consume budget and are reported separately from distinct genomes.
- `reports/business-evolution/selected-policy-traces.json`: cash paths and immutable accepted contracts for the enumerated training winner on final evaluation worlds.

The first version's source is reproducible from its Git commit. The second version's reports identify both the base Git revision and exact source hashes because an experiment may run before its source is committed. Search lineage is stored as data; the program and business vocabulary evolve through Git. No thousands of candidate branches or production changes are created.

## Boundaries

The market is intentionally smaller than the full model in `business-model/`: no taxes, financing terms, collection defaults, renewal beyond twelve months, staffing lead times, certification, physical authentication, strategic rival policy adaptation or real demand calibration. Assumed customer utility is not verified customer savings. Runoff retains fixed overhead for all 24 months. An insolvent company's continued cash schedule quantifies the hypothetical shortfall; it is not a claim that the company can keep paying. Its subsequent new sales stop. Service cancellation is allowed after three paid months, and the entry fee remains due.

The optimizer changes data within a finite vocabulary. It does not rewrite arbitrary TypeScript, alter its own tests, run an LLM, or deploy a policy through Workflow SDK. Agent-proposed new mechanisms should be separate versioned changes to the simulator or intervention vocabulary, with counterexamples and fresh evaluation scenarios. Durable execution belongs after a policy is selected and authorized for actual operations.
