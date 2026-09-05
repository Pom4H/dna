# Model uncertainty before automating operations

A user-supplied reference prompted the cash-flow counterexample: ["Почему на старте опасно строить маленькую корпорацию и какая система управления действительно нужна молодому бизнесу", September 4, 2026](https://secrets.tbank.ru/blogi-kompanij/kakaya-sistema-upravleniya-nuzhna-molodomu-biznesu/). This is the author's account in a company blog, not independent validation of DNA.

The article argues for minimal management overhead, explicit responsibilities, cash-flow sensitivity checks and automation after a process becomes repeatable. Its warning about profitable growth consuming cash motivated a separate timed-liquidity check. We do not reproduce its business data or claim its company uses DNA.

## Our design response

Treat a model as a revisable hypothesis, not a mandatory operating procedure. An unknown input is an acceptable representation of uncertainty, but not a passing result. A failed scenario should produce a useful counterexample rather than be edited until the dashboard turns green.

A minimum experiment needs a question, explicit inputs, an executable decision rule and observations when available. It does not need a company-wide ontology, CRM, ERP, autonomous agent or universal process editor. Add a domain only when a concrete scenario needs it.

The cash-flow example is deliberately small: fictional upfront procurement, customer receipts, two overhead payments and a fixed 60-day horizon. One sales input affects both modeled profit and the cash timeline. This exposes why a profit predicate alone cannot stand in for a liquidity predicate. All assumptions and business thresholds are illustrative.

Keep recurring processes outside this kernel until their behavior is understood. DNA currently checks models; it does not authorize spending, hire people, execute contracts, send customer proposals or run operations.

## Experiment for DNA itself

Ask whether this library makes a meaningful change easier to review than a plain TypeScript function and ordinary tests. Model the same case both ways. Compare duplicated business inputs, clarity of unknowns/conflicts, counterexample quality and the effort needed to trace a failed check to its assumptions. Do not treat a longer declaration or a larger graph as a better outcome.

The decisive artifact is a reproducible failed case with an explanation, not an impressive catalog of domain packages.
