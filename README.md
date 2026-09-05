# DNA

**An open protocol for describing products, capabilities, evidence and compatibility to humans, software and AI agents.**

DNA is an experiment in building a typed graph of reality without creating another source of truth.

The core idea is simple:

> **DNA owns relationships, not reality.**

Prices can remain in ERP. Firmware versions can remain in Git. Hardware revisions can remain in CAD/PLM. Test results can remain in laboratory reports. Websites, applications, manuals and commercial proposals can remain where they already live.

DNA connects those authoritative sources into a reviewable semantic graph and can publish a deliberately limited public contract for other tools and companies.

Experimental **0.2.x**. TypeScript **7.0.2**, Bun **1.4.2**, zero runtime dependencies in the core, MIT licensed.

## Why

A company already has many sources of truth:

```text
Git                 knows software
ERP                 knows prices and stock
PLM / CAD           knows product structure
Test reports        know what was verified
CRM                 knows customers and deals
Website / PDFs      publish claims
Physical products   are reality itself
```

The missing layer is often the relationship between them:

```text
customer problem
      ↓
requirement
      ↓
capability
      ↓
implementation
      ↓
verification
      ↓
claim
      ↓
website / datasheet / proposal / support
```

DNA models that thread explicitly.

It should be possible to ask:

- Why does this firmware feature exist?
- Which customer problem does it serve?
- What verifies this capability?
- Where do we publicly promise it?
- What becomes stale if a test starts failing?
- Which products are compatible with this interface?
- What changed semantically between two product revisions?

If DNA is deleted, the business must continue to exist. You lose the graph, validation, impact analysis and agent-readable context — not your products, firmware, ERP or website.

## Public DNA contracts

A company can expose a projection of its internal knowledge as a small public contract.

```ts
import { contract } from "@pom4h/dna";

export const orbit = contract({
  dna: "1.0",
  id: "acme:orbit-c",
  revision: "C",
  publisher: "acme.example",

  authorities: [
    {
      id: "evidence.remote-diagnostics",
      href: "https://acme.example/evidence/rd-c",
      kind: "test-report",
    },
  ],

  entities: [
    {
      id: "product.orbit",
      type: "industrial-controller",
      revision: "C",
      name: "Orbit Controller",
    },
    {
      id: "interface.service-usb",
      type: "usb-c-service-port",
      revision: "1",
      name: "Service USB-C",
    },
  ],

  capabilities: [
    {
      id: "capability.remote-diagnostics",
      subject: "product.orbit",
      status: "available",
    },
  ],

  claims: [
    {
      id: "claim.remote-diagnostics",
      subject: "product.orbit",
      text: "Remote diagnostics is available for service workflows.",
      evidence: ["evidence.remote-diagnostics"],
    },
  ],

  relations: [
    {
      from: "product.orbit",
      type: "has-interface",
      to: "interface.service-usb",
    },
    {
      from: "product.orbit",
      type: "has-capability",
      to: "capability.remote-diagnostics",
    },
  ],
});
```

A public contract is **not** a dump of the company's internal DNA. It should contain only information the publisher intentionally exposes.

The current v1 experiment standardizes a deliberately small vocabulary:

| Concept | Meaning |
| --- | --- |
| `entity` | Something with stable identity, type and revision |
| `capability` | Something an entity can provide |
| `claim` | A statement the publisher chooses to make publicly |
| `evidence` / `authority` | A reference to where support for a statement lives |
| `relation` | A typed edge between public nodes |
| `revision` | The publisher's version of the public contract |

The protocol is intentionally smaller than the internal modeling API.

## Discovery

A publisher can expose a discovery document, for example at:

```text
https://acme.example/.well-known/dna
```

The path is a proposal for the experiment, not an IETF-registered well-known URI.

```json
{
  "dna": "1.0",
  "publisher": "acme.example",
  "contracts": [
    "https://acme.example/dna/orbit-c.json",
    "https://acme.example/dna/orbit-d.json"
  ]
}
```

The repository contains this exact flow in [`examples/public-contract.ts`](examples/public-contract.ts).

## Semantic diff

Git tells you which bytes changed. DNA can tell you which concepts changed.

```ts
import { semanticDiff } from "@pom4h/dna";
import { orbitC, orbitD } from "./examples/public-contract.ts";

console.log(semanticDiff(orbitC, orbitD));
```

For the fictional example the result is conceptually:

```text
changed entity      product.orbit             revision C → D
added   capability  remote-firmware-update
added   relation    Orbit has-capability remote-firmware-update
```

That is the beginning of semantic versioning for real products rather than source files.

A future platform could use this to answer:

```text
Can my design upgrade from revision C to D?
Which dependent systems should be revalidated?
Which public claims changed?
Which supplier updates affect my products?
```

## Internal model: from reality to contract

The TypeScript API exists to model relationships and checks inside a company.

```ts
const remoteDiagnostics = capability("capability.remote-diagnostics", {
  implemented: controller.fields.remoteDiagnosticsImplemented,
  transport: controller.fields.telemetryTransport,
}, ({ implemented, transport }) =>
  implemented && transport === "websocket"
);
```

A verification result can support a claim:

```ts
const diagnosticsClaim = claim("claim.remote-diagnostics", {
  dependencies: {
    verified: diagnosticsVerified,
  },
  evidence: [diagnosticsVerified],
  text: ({ verified }) => verified
    ? "Remote diagnostics lets service staff inspect the controller before a site visit."
    : "Remote diagnostics is not a verified public capability.",
});
```

The same capability may drive:

```text
firmware configuration
application capabilities
engineering diagrams
support workflows
website copy
sales datasheets
media briefs
```

See [`examples/product-dna.ts`](examples/product-dna.ts) and [`examples/product-thread.ts`](examples/product-thread.ts).

The important property is not generation. It is traceability.

A website may remain Astro. Firmware may remain C/C++. A schematic may remain KiCad. DNA can generate an artifact, validate one, or simply record that a public surface depends on a claim.

## Evidence, assumptions and unknowns

DNA must not turn absence of knowledge into false certainty.

Values can be:

```text
known
unknown
conflict
error
```

Inputs can be assumptions or observations with provenance.

```ts
assumption("IP65", "Target enclosure rating");

observation("IP65", {
  source: "test-report:environmental-421",
  at: "2026-09-05T10:00:00.000Z",
  scope: "Orbit revision D sample",
});
```

A passing TypeScript test does not prove the world is true. DNA tracks what a conclusion depends on so applications can distinguish modeled assumptions from declared observations.

The long-term rule is stronger:

> **Never copy a fact when you can reference its authority.**

Adapters to Git, ERP, PLM, databases, test systems and live devices should resolve authoritative values without making DNA another database that must be manually synchronized.

## Typed relations, not a universal ontology

DNA should not attempt to define every concept in the world.

The core stays small. Domain libraries can define reusable vocabularies:

```text
@dna/usb
@dna/modbus
@dna/industrial
@dna/identity
@dna/commerce
@dna/payments
```

Organizations can publish their own namespaces where a shared domain does not exist.

The useful standardization target is the grammar of identity, capability, evidence, constraints and relations — not one giant taxonomy.

## Agents

A public DNA ecosystem gives AI agents structured discovery instead of forcing them to infer product semantics from PDFs and webpages.

A future agent could ask a registry:

```ts
find({
  type: "industrial-controller",
  requires: [
    "capability.remote-diagnostics",
    "protocol.modbus-tcp",
  ],
  constraints: {
    supply: "24VDC",
  },
});
```

A supplier benefits from publishing an accurate contract because software and agents can select its product without guessing what catalog prose means.

This repository does **not** implement that registry or marketplace yet. It defines and tests the primitives needed to make one possible.

## Principles

1. **DNA owns relationships, not reality.** Existing authoritative systems remain authoritative.
2. **Never copy a fact when you can reference its authority.** Public contracts should reference evidence where possible.
3. **Derived knowledge must be reproducible from declared dependencies.** Hidden dependencies make impact analysis untrustworthy.
4. **Unknown is a valid state.** Missing evidence must not become `false` or `true` accidentally.
5. **Public contracts are projections.** Internal knowledge and sensitive evidence stay private unless explicitly published.
6. **The core stays small.** Domain vocabulary belongs in libraries and organization namespaces.
7. **Humans remain responsible for authority.** A schema can validate structure; it cannot prove a test report, supplier or claim is genuine.

## Current API

The internal experimental kernel includes:

```text
entity       stable identity with typed fields
fact         named knowledge slot
relation     represented today by explicit dependencies / public contract edges
derive       deterministic computed knowledge
rule         invariant that must hold
hypothesis   falsifiable predicate
problem      modeled reason / customer need
capability   derived ability
claim        public statement backed by declared evidence
artifact     deterministic projection into an external representation
publication  artifact that must explicitly depend on claims
contract     validated public DNA contract
semanticDiff semantic changes between public contracts
```

`problem`, `capability` and `claim` are currently thin typed constructs over the dependency graph. They are expected to evolve into first-class IR node kinds as the protocol stabilizes.

## Run it

Install Bun 1.4.2:

```sh
git clone https://github.com/Pom4H/dna.git
cd dna
bun install --frozen-lockfile
bun run verify
```

Useful commands:

```sh
bun test
bun src/cli.ts examples/product-dna.ts
bun src/cli.ts examples/product-thread.ts
bun run ir
```

CI pins Bun **1.4.2** and TypeScript **7.0.2**.

## Repository map

```text
src/contract.ts       public contract validation + semantic diff
src/semantics.ts      problem / capability / claim / publication
src/model.ts          dependency graph, scenarios, impact and provenance
src/artifacts.ts      projections into business artifacts
src/domains/          experimental reusable domain libraries
examples/product-dna.ts
examples/public-contract.ts
tests/
```

## What DNA is not

DNA is not an ERP, PLM, CRM, CMS, CAD system, database, authorization service or AI model.

It does not authenticate evidence, certify products, discover hidden JavaScript dependencies, prove market demand, or guarantee that a public contract reflects physical reality.

It is an experiment in making the **relationships between business reality, implementation, evidence and public promises explicit and machine-readable**.

## Direction

The intended architecture is:

```text
REAL WORLD + AUTHORITATIVE SYSTEMS
              ↓ adapters

          internal DNA graph

problem ─requires→ capability
capability ─implemented-by→ component
component ─verified-by→ evidence
evidence ─supports→ claim
claim ─published-in→ artifact

              ↓ projection

        PUBLIC DNA CONTRACT
              ↓
     registry / search / agents
              ↓
      compatible real systems
```

If this works, DNA contracts can become a common interface between manufacturers, integrators, software platforms and AI agents.

## License

MIT.
