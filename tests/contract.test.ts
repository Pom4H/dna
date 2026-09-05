import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, semanticDiff } from "../src/index.ts";
import { orbitC, orbitD, wellKnown } from "../examples/public-contract.ts";

test("public contract validates references and discovery", () => {
  assert.equal(orbitC.dna, "1.0");
  assert.equal(wellKnown.contracts.length, 2);
});

test("semantic diff describes product meaning, not file changes", () => {
  const changes = semanticDiff(orbitC, orbitD);
  assert.deepEqual(changes.map(change => [change.kind, change.category, change.id]), [
    ["changed", "entity", "product.orbit"],
    ["added", "capability", "capability.remote-firmware-update"],
    ["added", "relation", "product.orbit::has-capability::capability.remote-firmware-update"],
  ]);
});

test("dangling relations and evidence fail validation", () => {
  assert.throws(() => contract({
    ...orbitC,
    relations: [{ from: "product.orbit", type: "compatible-with", to: "missing.product" }],
  }), /unknown to/);

  assert.throws(() => contract({
    ...orbitC,
    claims: [{ ...orbitC.claims[0]!, evidence: ["missing.evidence"] }],
  }), /unknown evidence/);
});
