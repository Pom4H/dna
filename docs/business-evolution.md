# Business evolution experiment

This is a fictional market laboratory, not empirical validation or financial advice. Run `bun run evolve:business` with Bun 1.4.2. Full candidate genomes, parent IDs and fitness are written to `reports/business-evolution/full.json`; compact results go to `summary.json`.

The experiment evolves a company's commercial and operating policy: channel, purchase versus service, entry price, recurring price, deposit, installation hours, component and support. Every candidate competes with three fictional rival policies for the same buyers, monthly kit stock and installer hours. Rival policies are fixed; their cash, customers and reputation change. This is not an equilibrium or coevolution of all players.

Buyer reach, utility, price sensitivity, liquidity, incidents and cancellation are explicit synthetic assumptions in `examples/business-evolution/model.ts`. Contract terms are immutable snapshots. Revising an offer affects only later cohorts. Each market has 12 acquisition months followed by 12 runoff months; all accepted service and collection schedules finish before scoring. Cash is tracked per movement, including acquisition, kit and installation payments before future subscription receipts, fixed costs, service costs and credits. There is no terminal valuation or assumed hardware resale.

DNA gates require at least six installation hours, nonnegative minimum cash, no resource overdraw and no unfinished modeled obligations. Missing outcomes produce unknown decisions. The fixed objective, after these gates, is `0.5 × mean net cash + 0.5 × worst net cash` across six training markets. This weighting is a design choice, not an estimated risk preference. A nonnegative cash path can still end with an operating loss.

Search uses uniform crossover, mutation of at least one locus, an archive of distinct elites and 25% random immigrants. Three optimizer seeds each receive 96 new candidates × 12 generations. A random search receives the same number of evaluations and the same training worlds. Counter-based draws keep exogenous customer events aligned across policy comparisons. Held-out markets are evaluated only after training selection. Four stronger scenario changes are reported separately and cannot pick the winner.

## First experiment

The eight-gene model evaluated 6,912 strategy trials across evolutionary and random search, or 41,472 training-market simulations. Each market contains four company trajectories; the trials are alternative fictional companies, not thousands of real businesses. Genetic runs converged to the same policy: partner channel, service, EUR 720 entry charge, EUR 360 monthly, zero deposit, six installation hours, rugged component, lean support. Mean training net cash was EUR 95,839.60. All three genetic winners failed solvency on held-out seeds despite positive mean final net cash of EUR 64,100.40. Both random-search winners also failed held-out solvency. The baseline had mean held-out net cash of EUR −52,266.67.

This exposed a missing business intervention: admission control for new installations. Funding a kit today is insufficient if the remaining cash cannot cover tomorrow's fixed costs. The failed result is retained in Git and `business-evolution-v1-results.json`. It motivates a new model version, not promotion of the first winner.

## Boundaries

The market is intentionally smaller than the full model in `business-model/`: no taxes, financing terms, collection defaults, renewal beyond twelve months, staffing lead times, certification, physical authentication, strategic rival policy adaptation or real demand calibration. Assumed customer utility is not verified customer savings. Runoff retains fixed overhead for all 24 months. An insolvent company's continued cash schedule quantifies the hypothetical shortfall; it is not a claim that the company can keep paying. Its subsequent new sales stop. Service cancellation is allowed after three paid months, and the entry fee remains due.

The optimizer changes data within a finite vocabulary. It does not rewrite arbitrary TypeScript, alter its own tests, run an LLM, or deploy a policy through Workflow SDK. Agent-proposed new mechanisms should be separate versioned changes to the simulator or intervention vocabulary, with counterexamples and fresh evaluation scenarios. Durable execution belongs after a policy is selected and authorized for actual operations.
