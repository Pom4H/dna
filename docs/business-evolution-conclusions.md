# Conclusions: evolving a business with DNA

**DNA can provide a reproducible way to propose, compare and preserve changes to a business. The intervention vocabulary and the validity of the simulated world determine what those changes mean.** The current experiment demonstrates this mechanism on fictional companies; it does not establish that a policy improves a real business.

The [experiment and methodology](business-evolution.md) and [recorded results](business-evolution-results.json) support the findings below. Statements about future architecture are proposals, not implemented capabilities.

## What we learned

| Finding | Evidence from this experiment | Consequence for DNA |
| --- | --- | --- |
| A useful business change can be absent from the search space. | The first policy vocabulary had no operating-cash reserve. Its winners failed unseen synthetic liquidity paths. Adding the reserve made a different admission policy expressible. | Evolve both policy values and the vocabulary of permitted interventions. More search within the old vocabulary cannot discover an absent mechanism. |
| Business outcomes depend on the whole path. | A service business could finish with positive net cash after an earlier cash deficit. | Evaluate procurement, collection, support and commitments over time; final balances alone are insufficient. |
| Search can improve the declared objective without improving every business concern. | The evolutionary winner's fresh-scenario mean net cash was EUR 96,116.80 versus EUR 91,923.87 for the random winner, but its minimum cash was EUR 2,329.60 versus EUR 7,602.40. | Preserve alternatives across cash generation, liquidity and resilience. Make tradeoffs visible to the decision-maker. |
| A genetic algorithm is useful but not essential to the representation. | All three genetic runs found the finite-grid optimum; random search was only 1.69% behind on the training objective. Full enumeration covered all 6,912 policies, of which 1,237 passed every training gate. | Keep search replaceable. Use complete enumeration when affordable and an equal-budget random baseline when comparing heuristics. These runs do not establish universal algorithm superiority. |
| A valid program can encode an inadequate theory of the market. | Reach, customer budgets, utility, incidents and cancellation are hand-specified. Rival policies do not adapt strategically. | Version assumptions as part of the environment. Passing type checks and scenario gates does not authenticate evidence or prove demand, causality or competitive equilibrium. |
| Preserving obligations is part of evolution. | Accepted cohorts retain their terms when future offers change; a runoff period includes their modeled service and collection schedules. | Keep identities and accepted commitments separate from the current policy. A new genome cannot rewrite an old promise to improve its score. |

The reserve change and the added training counterexamples were introduced together in v2. The individual regression test demonstrates that a reserve repairs the reproduced liquidity path; the aggregate v1-to-v2 difference does **not** isolate the causal contribution of the reserve alone. Likewise, the three search seeds are a small controlled algorithm comparison, not a statistically established success rate.

## Two levels of evolution

**Policy search** operates inside a fixed, typed vocabulary: prices, channel, payment structure, installation effort, component, support and admission reserve. Its evaluator, obligations and scenario definitions remain fixed for a comparison. The existing TypeScript search implements this level.

**Model development** introduces another way of operating: a reserve, acquisition pacing, financing, alternative service organization or resource sharing. An agent can propose such a change with a reason, dependencies, expected effect and a counterexample. It is a versioned change to code or assumptions, followed by a new evaluation cycle. The current reserve change was an explicit development step; there is no autonomous source-rewriting agent in this experiment.

These levels need separate histories. Candidate lineage records which policies were crossed or mutated. Git records changes to the intervention vocabulary, simulator and evaluator. A change to the evaluator is a change to the definition of success and must remain distinguishable from a candidate improvement under an unchanged evaluator.

## Proposed division of responsibilities

| Component | Responsibility |
| --- | --- |
| Business model and dependency graph | Identify subjects, resources, offers, accepted contracts and the facts used by decisions. |
| Typed intervention | Describe a permitted change, its scope and which future decisions it can affect. |
| Simulator | Advance cash, capacity, commitments and customer/rival behavior under explicit assumptions. |
| DNA assessment | Preserve unknown/conflict/error states and check the declared constraints over supplied outcomes. |
| Search algorithm | Propose and compare policies under a fixed evaluation protocol. |
| Agent | Propose new interventions, inspect failed scenarios and challenge missing assumptions through reviewable changes. |
| Git and experiment records | Preserve source revisions, scenario definitions, evidence labels, parent lineage and reproducible results. |
| Workflow SDK and operational authorities | Execute an authorized selected policy with durable progress, current authorization, resource checks and idempotent effects. This evolutionary loop is not yet connected to live execution. |

Types constrain the shape of an intervention. Whether a particular company can afford or fulfill it depends on runtime facts and the state trajectory. A passing simulation is conditional on its supplied assumptions. Workflow durability preserves execution progress; authentication of evidence and the idempotency of an external effect require their own mechanisms.

## Next work, in order

1. **Retain policies with different tradeoffs.** Add a Pareto archive over declared cash generation, minimum cash and stress outcomes. Retain policies for which no other candidate is at least as good on every chosen measure and strictly better on one. Keep hard invariants outside these tradeoffs. Test archive membership with explicit dominated and incomparable examples.
2. **Make changes explainable.** Express ordinary TypeScript interventions such as changing future billing terms or introducing admission reserves. Record their affected domains, applicable revision and accepted commitments that must remain unchanged. Test both propagation and non-propagation. Keep these in the example until another domain demonstrates a reusable abstraction.
3. **Improve the opponent and scenario model.** Add cash-dependent growth and declared rival reactions, while retaining fixed-opponent controls. Report which policy fails under which environment. Once an evaluation set informs development, treat it as development evidence and use a fresh set for the next final comparison.
4. **Separate simulated feedback from observations.** Link permissioned observations to the specific assumption and scope they can inform. Missing demand or retention evidence remains unknown. Do not turn fictional customer utility into a claim about measured customer savings.
5. **Connect policy selection to the durable demo.** Bind a selected policy revision to newly accepted operations, check authority and current resources at execution time, and retain existing contract terms and product-instance identity. Test retries and restart recovery without duplicate effects or retrospective repricing.

For now, the small public kernel is sufficient. The next useful abstraction should come from repeated business interventions, rather than adding a universal optimizer, custom language or autonomous execution service to the core.

## Decision

Continue DNA as a system for **versioned business interventions, reproducible counterexamples and explicit tradeoffs**. Use agents to expand and challenge the modeled choices, deterministic evaluation to compare them, and durable workflows to carry out the selected changes. The current result justifies developing this experimental loop; it does not justify promoting the synthetic winner as a validated business strategy.
