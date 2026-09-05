import { test } from "node:test";
import assert from "node:assert/strict";
import { assumption, type Artifact, type Computed, type Scenario, type Value } from "../src/index.ts";
import * as saas from "../examples/cross-domain/saas.ts";
import * as service from "../examples/cross-domain/services.ts";
import * as publishing from "../examples/cross-domain/publishing.ts";
import * as booking from "../examples/cross-domain/reservations.ts";

function read<T>(scenario: Scenario, node: Value<T>): T {
  const result = scenario.read(node);
  if (result.status !== "known") throw new Error(`${node.id}: ${result.status}`);
  return result.value;
}
function content(scenario: Scenario, node: Computed<Artifact>): string { return read(scenario, node).content; }

test("SaaS: a changed offer updates pricing, not an existing invoice or accepted entitlements", () => {
  assert.notEqual(content(saas.baseline, saas.pricing), content(saas.repriced, saas.pricing));
  for (const node of [saas.billing, saas.api, saas.support]) assert.equal(content(saas.baseline, node), content(saas.repriced, node));
  assert.equal(JSON.parse(content(saas.repriced, saas.billing)).amountCents, 2900);
  assert.equal(read(saas.repriced, saas.canInvite), true);
  assert.deepEqual(saas.business.impact(saas.offer.fields.monthlyCents), [saas.pricing.id]);
});

test("SaaS: the same product can be usable for one tenant and denied to another", () => {
  assert.equal(read(saas.baseline, saas.canInvite), true);
  assert.equal(read(saas.outsider, saas.canInvite), false);
  assert.notEqual(content(saas.baseline, saas.api), content(saas.outsider, saas.api));
  assert.equal(content(saas.baseline, saas.pricing), content(saas.outsider, saas.pricing));
});

test("SaaS: finite policy sweep, including boundary and cross-tenant requests", () => {
  let cases = 0;
  for (const active of [false, true]) for (const sameTenant of [false, true]) {
    for (const role of ["owner", "viewer"] as const) for (const occupied of [0, 9, 10, 11]) {
      const scenario = saas.baseline.fork(`policy-${cases++}`)
        .set(saas.agreement.fields.active, assumption(active, "Synthetic sweep"))
        .set(saas.request.fields.tenant, assumption(sameTenant ? "tenant.example" : "tenant.other", "Synthetic sweep"))
        .set(saas.request.fields.role, assumption(role, "Synthetic sweep"))
        .set(saas.request.fields.occupiedSeats, assumption(occupied, "Synthetic sweep"));
      const expected = active && sameTenant && role === "owner" && occupied < 10;
      assert.equal(read(scenario, saas.canInvite), expected);
    }
  }
  assert.equal(cases, 32);
});

test("SaaS: explicit public projection excludes private fields and their provenance", () => {
  const result = saas.baseline.read(saas.pricing);
  assert.doesNotMatch(JSON.stringify(result), /private-person|privateEmail|tenant\.example/);
  assert.deepEqual(saas.business.impact(saas.request.fields.privateEmail), []);
});

test("Services: offer scope changes website and proposal, never silently rewrites accepted work", () => {
  for (const node of [service.website, service.proposal]) {
    assert.notEqual(content(service.baseline, node), content(service.expandedOffer, node));
    assert.match(content(service.expandedOffer, node), /Implementation/);
  }
  for (const node of [service.workOrder, service.invoice, service.schedule]) assert.equal(content(service.baseline, node), content(service.expandedOffer, node));
  assert.deepEqual(service.business.impact(service.offer.fields.deliverables), [service.proposal.id, service.website.id]);
});

test("Services: competence/offer does not reserve enough time to deliver", () => {
  assert.equal(read(service.baseline, service.canSchedule), true);
  assert.equal(read(service.overloaded, service.canSchedule), false);
  assert.throws(() => service.overloaded.evaluate().assert(), /service.delivery-feasible/);
  assert.equal(content(service.baseline, service.website), content(service.overloaded, service.website));
  assert.notEqual(content(service.baseline, service.schedule), content(service.overloaded, service.schedule));
});

test("Services: milestone acceptance changes billing, not price, scope or capacity", () => {
  assert.equal(JSON.parse(content(service.baseline, service.invoice)).billableCents, 0);
  assert.equal(JSON.parse(content(service.accepted, service.invoice)).billableCents, 120000);
  for (const node of [service.website, service.proposal, service.workOrder, service.schedule]) assert.equal(content(service.baseline, node), content(service.accepted, node));
  assert.deepEqual(service.business.impact(service.engagement.fields.milestoneAccepted), [service.invoice.id]);
});

test("Services: capacity equality and missing customer inputs are explicit cases", () => {
  const justEnough = service.baseline.set(service.staffing.fields.freeHours, assumption(12, "Boundary"));
  assert.equal(read(justEnough, service.canSchedule), true);
  const notReady = justEnough.set(service.engagement.fields.inputsReady, assumption(false, "No access to customer system"));
  assert.equal(read(notReady, service.canSchedule), false);
});

test("Publishing: one asset has different permission by channel and market", () => {
  assert.equal(read(publishing.baseline, publishing.webAllowed), true);
  assert.equal(read(publishing.baseline, publishing.socialAllowed), false);
  assert.equal(read(publishing.differentMarket, publishing.webAllowed), false);
  assert.equal(JSON.parse(content(publishing.baseline, publishing.website)).publish, true);
  assert.equal(JSON.parse(content(publishing.baseline, publishing.campaign)).publish, false);
});

test("Publishing: expiry and revocation remove placement, not the original asset", () => {
  for (const scenario of [publishing.expired, publishing.revoked]) {
    assert.equal(read(scenario, publishing.webAllowed), false);
    assert.equal(JSON.parse(content(scenario, publishing.website)).uri, undefined);
    assert.notEqual(content(scenario, publishing.runbook), content(publishing.baseline, publishing.runbook));
    assert.equal(content(scenario, publishing.archive), content(publishing.baseline, publishing.archive));
  }
  assert.ok(!publishing.business.impact(publishing.grant.fields.revoked).includes(publishing.archive.id));
});

test("Publishing: permissions have a half-open validity interval", () => {
  for (const [now, allowed] of [[999, false], [1000, true], [1500, true], [1999, true], [2000, false], [2001, false]] as const) {
    assert.equal(read(publishing.baseline.set(publishing.context.fields.now, assumption(now, "Boundary")), publishing.webAllowed), allowed);
  }
});

test("Publishing: approval of one revision cannot authorize a different asset revision", () => {
  const replacement = publishing.baseline.set(publishing.asset.fields.revision, assumption("asset-v4", "New edit requires clearance"));
  assert.equal(read(replacement, publishing.webAllowed), false);
  assert.notEqual(content(replacement, publishing.archive), content(publishing.baseline, publishing.archive));
});

test("Reservations: snapshot expiry changes search and request, not listing or confirmation", () => {
  assert.equal(read(booking.baseline, booking.bookable), true);
  assert.equal(JSON.parse(content(booking.expired, booking.searchResult)).availability, "unknown");
  assert.throws(() => booking.expired.evaluate().assert(), /booking.fresh-inventory-required/);
  assert.equal(content(booking.baseline, booking.listing), content(booking.expired, booking.listing));
  assert.equal(content(booking.baseline, booking.confirmation), content(booking.expired, booking.confirmation));
});

test("Reservations: sold-out is known unavailable, not unknown", () => {
  assert.equal(JSON.parse(content(booking.soldOut, booking.searchResult)).availability, "unavailable");
  assert.equal(read(booking.soldOut, booking.bookable), false);
});

test("Reservations: advertised price changes cannot reprice an accepted booking", () => {
  const changed = booking.baseline.set(booking.slot.fields.priceCents, assumption(7000, "New catalog price"));
  assert.equal(JSON.parse(content(changed, booking.confirmation)).agreedCents, 4500);
  assert.equal(content(changed, booking.confirmation), content(booking.baseline, booking.confirmation));
  assert.deepEqual(booking.business.impact(booking.slot.fields.priceCents), [booking.listing.id]);
});

test("Reservations: two green snapshot checks do NOT reserve the last seat twice", () => {
  const alice = booking.baseline.fork("alice");
  const bob = booking.baseline.fork("bob");
  assert.equal(read(alice, booking.bookable), true);
  assert.equal(read(bob, booking.bookable), true);
  assert.equal(JSON.parse(content(alice, booking.confirmation)).confirmed, false);
  // Test-only authority stand-in. A real implementation needs a DB transaction/CAS.
  let version = 7;
  let remaining = 1;
  function reserve(expectedVersion: number): boolean {
    if (expectedVersion !== version || remaining < 1) return false;
    remaining -= 1;
    version += 1;
    return true;
  }
  assert.equal(reserve(read(alice, booking.inventory.fields.version)), true);
  assert.equal(reserve(read(bob, booking.inventory.fields.version)), false);
  assert.equal(remaining, 0);
});

test("All four domains keep synthetic source provenance; none proves a real-world outcome", () => {
  for (const domain of [saas, service, publishing, booking]) {
    for (const surface of domain.surfaces) {
      const result = domain.baseline.read(surface);
      assert.equal(result.status, "known");
      assert.equal(result.basis, "assumptions");
      assert.ok(result.origins.every(origin => origin.provenance.kind === "assumption"
        && origin.provenance.reason.includes("SYNTHETIC snapshot") && origin.provenance.reason.includes("sha256:")));
    }
    assert.throws(() => domain.baseline.evaluate().assert({ requireObservations: true }), /requires observations/);
  }
});
