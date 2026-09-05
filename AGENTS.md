# Working on DNA

Read README.md and docs/architecture.md before changing semantics. Keep the project small and use ordinary TypeScript. Do not add an application, database, LLM service, custom parser, decorators or code generation without an actual use case.

- Use Bun **1.4.2** and TypeScript **7.0.2**. Run `bun run verify` before a change is considered checked.
- Add a failing regression/counterexample before fixing behavior. Include negative type contracts in `tests/types.ts` when changing generics.
- Unknown must never become false, conflict must never resolve silently, and synthetic scenarios must never be described as empirical validation.
- Preserve literal inference in assertions and schema types. Do not weaken `NoInfer`, strict compiler options, or runtime validation to silence a test.
- All examples must be fictional or explicitly permissioned. Never add real customer documents, personal finances, credentials or identifying sample data to this public repository.
- Evidence labels are caller assertions. Do not claim source authentication, statistical significance or causality unless separately implemented and tested.
- New domains must be ordinary factories using the public kernel. Keep product-specific behavior out of generic protocol vocabularies.
- CLI import executes trusted code. Do not present it as safe execution of arbitrary AI-generated TypeScript.
- Commit lockfile changes with dependency changes. Do not publish to npm or create releases automatically.
