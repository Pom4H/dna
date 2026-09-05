# Cross-domain stress test

## Conclusion

The explicit dependency/snapshot kernel can express useful scenarios in subscriptions, professional services, media distribution and reservations without new kernel primitives. The current public wire contract cannot preserve several distinctions those scenarios require. Building a registry or promoting the hardware vocabulary to a universal standard is premature.

This experiment tests the implementation and our modeling assumptions, not market demand or real-world correctness. All source data is synthetic. No billing account, rights registry, customer system or reservation service was connected or changed.

## Method

For each domain:

1. Read a synthetic upstream snapshot through a runtime schema and record its content digest as assumption provenance.
2. Define the business identities and distinguish offered terms, accepted commitments and request-time state.
3. Project the same facts into several concrete JSON/Markdown outputs.
4. Change one thing. Assert both expected propagation and required non-propagation.
5. Write counterexamples where a schema, green check or public contract loses the distinction that matters.

The source data is in `examples/cross-domain/fixtures/`. The declarations are in `examples/cross-domain/`. `bun run domains` writes a summary and preview files under `reports/domain-stress/`. It deliberately renders failed scenarios for inspection; the directory is never a release bundle.

The initial full probe commit is `83f1c772b67cdf8e1c5b735d12cceecae513d94f`. Its CI run [33962446801](https://github.com/Pom4H/dna/actions/runs/33962446801) executed **108 tests: 101 passed and seven contract regressions failed**. The cross-domain examples and eight known-gap characterizations already ran successfully at that point. The seven regression failures are retained in history before their fixes.

```sh
bun run test:domains
bun run domains
# Inspect reports/domain-stress/summary.json and previews/.
```

There are 14 exported scenarios and 17 surface definitions. This is bounded scenario testing, not a proof of a universal model.

## 1. Subscription software

**Authority boundaries:** offer catalog; accepted billing agreement; identity/usage snapshot.

**Shared thread:** a subscription offer supplies website pricing; a specific agreement supplies the billing line and seat entitlement; the same entitlement and authenticated-request snapshot supply an API decision and support explanation.

**Breaking case:** the catalog changes from $39 / five seats to $49 / two seats, while a previous agreement remains $29 / ten seats. Synchronizing one global `price` or `seats` property across every surface would alter accepted obligations. Separate fact identities are necessary; this is not accidental duplication.

Tests verify that only the pricing output changes. The existing invoice and allowed invite remain unchanged. Switching the requesting tenant changes authorization/support, not public pricing. A 32-case bounded policy sweep covers activity, tenant, role and seat boundaries.

**Public-contract failure:** `status: available` cannot mean both offered by the service and permitted to this actor under this agreement. Request context is part of the decision. The current wire schema rejects an explicit context object and does not carry typed price/limit properties.

**Privacy failure:** the internal snapshot includes a synthetic private email. A deliberately narrow pricing projection omits it and its fact provenance; exporting the entire scenario includes it. Public export needs a designed disclosure boundary, not `JSON.stringify(internalModel)`.

## 2. Professional services

**Authority boundaries:** service catalog; accepted engagement scope; staffing calendar; milestone acceptance.

**Shared thread:** offer → website and new proposal; accepted scope → work order; accepted effort + capacity + readiness → schedule check; milestone acceptance + agreed fee → invoice candidate.

**Breaking case:** adding implementation work to a new offer must not add it to an already accepted audit. A service can be advertised and the company can possess the skill while the relevant delivery window lacks capacity. A publication-oriented capability flag does not establish a delivery commitment.

Tests verify that expanded offered scope changes website/proposal only; overcommitment fails the planning rule without deleting the offer; acceptance makes the agreed fee billable without changing scope, price or schedule.

**Boundary:** estimated hours and milestone terms are deliberately simplified fictional policies. DNA does not book staff, adjudicate acceptance or implement accounting rules. Successful planning needs an authoritative commitment operation before the capacity can be promised.

## 3. Media distribution

**Authority boundaries:** source asset and revision; distribution-permission register; intended channel, market and evaluation time.

**Shared thread:** one asset and one permission record supply web placement, social placement and a distribution runbook. The archive reference depends on asset identity/revision, not on current permission to publish.

**Breaking case:** the same revision is allowed on the web in one market but not in social media or another market. Permission expires at the end of a half-open interval. Revocation blocks placement; it does not destroy the source asset. Editing the asset revision invalidates permission scoped to the previous revision.

Tests verify these contextual decisions and that the original archive remains unchanged when distribution is blocked.

**Public-contract failure:** a global available/unavailable property cannot encode this relation without discarding scope. The fixed relation enum rejects a domain-namespaced `example:licensed-for` relation. This is a structural vocabulary limitation, not a reason to add every licensing term to core.

**Boundary:** these are fictional editorial policies, not legal interpretation, rights clearance or automatic revocation of copies already published elsewhere.

## 4. Reservations

**Authority boundaries:** scheduled workshop catalog; versioned inventory snapshot; reservation request; authoritative accepted booking record.

**Shared thread:** slot identity supplies listing, search result, reservation intent and confirmation. Current catalog price and an accepted booking's agreed price are distinct facts. The intent carries the inventory version used for the check.

**Breaking case:** Alice and Bob both see one seat and both obtain a positive feasibility result. Neither result reserves the seat. A test-only compare-and-swap authority stand-in accepts the first versioned request and rejects the second. It illustrates the necessary boundary; it is not an implemented transactional reservation service.

Tests also distinguish stale inventory (`unknown` to the search consumer) from fresh sold-out inventory (`unavailable`). Expiring availability changes search/intent but not the event listing or accepted confirmation. Changing advertised price does not reprice a booking.

**Boundary:** a pure evaluator can describe/check a transition request. Only the runtime authority can atomically validate and commit it. Retrying, idempotency, rollback, distributed concurrency and actual inventory integrity remain outside DNA.

## Seven reproduced defects fixed narrowly

These defects apply across domains; fixing them does not require another ontology.

| Defect | Reproduction | Correction |
| --- | --- | --- |
| Ambiguous node identity | An authority and service entity can share an ID | Enforce uniqueness across all contract node collections |
| Wrong subject category | A capability can name an evidence document as its subject | Require an entity subject |
| Circular evidence by assertion | A public claim can cite itself as evidence | Evidence references must name authorities; duplicate evidence references are rejected |
| Duplicate relation loss | Repeated edges disappear in map-based comparison | Reject duplicate relation tuples before diff |
| Invisible source changes | Change an authority URL; old diff reports nothing | Include authority changes |
| Invisible envelope changes | Change publisher or revision; old diff reports nothing | Include the contract envelope as `$contract` |
| Order-sensitive evidence | Reorder identical evidence references; old diff reports a changed claim | Compare evidence references as a sorted set |

Claim subjects may name entities or capabilities. Empty evidence remains explicitly empty; structural validation does not label it supported. Authority references are not authenticated. Relation endpoint categories and the interpretation/direction of every predicate are not comprehensively defined by these fixes.

The diff now reports `contract`, `authority`, `entity`, `capability`, `claim` and `relation` categories. Consumers of this experimental API need to handle the additional categories. It still cannot decide whether a supplier revision is compatible with a particular consumer. Nor does it fetch changed content behind an unchanged URL.

## Eight open gaps kept executable

`tests/known-gaps.test.ts` is intentionally named and commented. **A passing characterization means the gap was reproduced, not repaired.** Stronger semantics should replace the relevant characterization with a desired-behavior regression when they are implemented.

| ID | Observed limitation | Why it matters |
| --- | --- | --- |
| G1 | A claim renderer can ignore false approval. Reading a publication still produces content even when a model rule fails. | Declared evidence dependencies are not a publication gate. No rendering output should be mistaken for approval. |
| G2 | An observation with an old timestamp and unrelated scope passes the observations-only label gate. | Origin labels are not freshness, relevance or source authenticity. |
| G3 | Differing observations from two periods become a conflict in one slot. | Contradiction, history and context require distinct treatment; an assertion list is not a time series. |
| G4 | Numeric values labeled EUR and USD can be added. | Unit metadata documents intent but does not enforce arithmetic semantics. |
| G5 | Known `active=false` plus unknown credit produces unknown before an `&&` callback runs. | Eager dependencies are conservative; ordinary short-circuit behavior is not represented. Do not solve this by globally treating unknown as false. |
| G6 | The public capability shape rejects actor/time/market qualifiers. | Public export cannot preserve contextual availability. |
| G7 | The relation enum rejects namespaced domain relations. | A vocabulary inferred from products limits other domains. |
| G8 | Exporting an internal scenario includes private facts. | Selective public projections and internal audit exports are different interfaces. |

The reservation race is an additional executable systems boundary in `tests/cross-domain.test.ts`, not a gap we intend to hide inside a general graph API.

## What survives the experiment

The useful shared mechanism is **explicit fact identity + source snapshot + dependency tracing + decision checks + selective projections**. None of the four examples needs a new built-in `Customer`, `License`, `Booking` or `Invoice` class.

Several distinctions recur:

- An offer/definition is not an accepted instance or obligation.
- A capability is not an actor's permission, a current capacity estimate or an accepted commitment.
- A claim is not its evidence, and evidence about one scope/version/time is not evidence about another.
- A positive decision computed from a snapshot is not an executed action.

These are design constraints, not a decision to add four more wrappers. Prototype the necessary distinctions in real cases before selecting a transport representation.

## What changes in direction

**Keep the kernel small.** The four working examples use existing entities, facts, computations and artifacts. Do not rush to promote their domain-specific predicates into core.

**Do not freeze the public format.** The existing `dna: "1.0"` is a prototype label. A meaningful round trip must preserve context, typed values and applicable evidence. The current wire format has not demonstrated that. Encoding missing semantics into prose or opaque IDs would only conceal the loss.

**Separate rationale from computation.** A relationship such as “addresses customer problem” need not force a firmware build or pricing calculation to change when wording is edited. Conversely, a computational dependency is not automatically a causal claim about the world. The current dependency DAG is not a complete business knowledge graph.

**Keep decisions separate from side effects.** Authoritative systems retain responsibility for current authorization, acceptance and reservations. Artifact previews are not a release process. A future publication boundary must explicitly apply appropriate checks before writing public surfaces.

**Allow reproducible snapshots, forbid competing editable facts.** The example adapter rereads source bytes and pins a digest. It does not become another catalog. Its whole-file digest is coarse and can over-invalidate provenance when unrelated source fields change; fine-grained source selection/versioning is not implemented. Source authentication is a separate concern.

**Measure value before expanding.** These tests demonstrate internal consistency and expose losses in the abstractions. They do not show lower cognitive cost or less maintenance than ordinary TypeScript functions, schemas and tests. The amount of declaration boilerplate in these small examples is itself a warning to measure rather than a success metric.

## Acceptance criteria before a registry

A future portable experiment should preserve these four domains' meanings through export/import, reject stale or inapplicable support for a published claim, avoid leaking private context, and express an authoritative operation boundary without executing arbitrary remote TypeScript. The current implementation does not meet those criteria.

Until then, a registry would index a lossy description, not solve the underlying modeling problem. Keep the counterexamples visible and use them to evaluate the next design rather than increasing the number of domain packages.
