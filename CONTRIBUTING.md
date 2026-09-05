# Contributing

DNA is an experiment. Small examples that expose a missing modeling capability are more useful than a large feature proposal.

Use Bun 1.4.2. Clone, run `bun install --frozen-lockfile`, then `bun run verify`. There is no build service, account or API key to configure. Commands are the same on macOS, Linux and Windows when Bun and Git are installed.

Add a focused test for the behavior you want to change. Core tests use `node:test` and `node:assert/strict`, executed by Bun's test runner. `tests/types.ts` contains compiler-only positive and negative API contracts. Keep example data synthetic and label assumptions explicitly.

A hypothesis test passing with supplied assumptions only establishes a conditional result in that model. It does not establish customer demand, factual accuracy, product safety or causality. Preserve that distinction in APIs and documentation.

Submit a pull request describing the model/example, the counterexample it adds, and the verification commands you actually ran. Current API and IR formats are experimental and may change before a stable release. Contributions are MIT licensed.
