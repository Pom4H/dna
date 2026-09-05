import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, semanticDiff, type DnaContract } from "../src/index.ts";

function sample(): DnaContract {
  return { dna: "1.0", id: "example:service", revision: "1", publisher: "example.invalid",
    authorities: [
      { id: "evidence", kind: "document", href: "https://example.invalid/policy-v1" },
      { id: "second", kind: "service", href: "https://example.invalid/approvals" },
    ],
    entities: [{ id: "service", type: "professional-service", revision: "1", name: "Review" }],
    capabilities: [{ id: "review", subject: "service", status: "available" }],
    claims: [{ id: "promise", subject: "service", text: "Review is offered", evidence: ["evidence", "second"] }],
    relations: [{ from: "service", type: "has-capability", to: "review" }],
  };
}

test("REGRESSION: IDs must be unambiguous across all contract node collections", () => {
  const value = sample();
  // Preserve the original evidence, so no dangling reference can mask the collision.
  assert.throws(() => contract({ ...value, authorities: [...value.authorities, { ...value.authorities[0]!, id: "service" }] }), /duplicate|collision/);
});
test("REGRESSION: a capability's subject must be an entity, not an evidence document", () => {
  const value = sample();
  assert.throws(() => contract({ ...value, capabilities: [{ ...value.capabilities[0]!, subject: "evidence" }] }), /subject/);
});
test("REGRESSION: a claim cannot cite itself as evidence", () => {
  const value = sample();
  assert.throws(() => contract({ ...value, claims: [{ ...value.claims[0]!, evidence: ["promise"] }] }), /evidence/);
});
test("REGRESSION: duplicate relations must not silently disappear inside semantic diff", () => {
  const value = sample();
  assert.throws(() => contract({ ...value, relations: [...value.relations, value.relations[0]!] }), /duplicate/);
});
test("REGRESSION: changed evidence authority appears in semantic diff", () => {
  const value = sample();
  const changes = semanticDiff(value, { ...value, authorities: [{ ...value.authorities[0]!, href: "https://example.invalid/policy-v2" }, value.authorities[1]!] });
  assert.ok(changes.some(change => String(change.category) === "authority" && change.id === "evidence"));
});
test("REGRESSION: publisher and contract revision changes must not be invisible", () => {
  const value = sample();
  const changes = semanticDiff(value, { ...value, publisher: "other.example.invalid", revision: "2" });
  assert.ok(changes.some(change => String(change.category) === "contract"));
});
test("REGRESSION: ordering evidence references does not change the statement", () => {
  const value = sample();
  const changes = semanticDiff(value, { ...value, claims: [{ ...value.claims[0]!, evidence: ["second", "evidence"] }] });
  assert.deepEqual(changes, []);
});
