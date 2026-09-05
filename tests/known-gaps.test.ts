/** Characterization tests: green means the gap is reproducible, NOT that it is fixed.
 * Keep these conspicuous until their replacement tests can assert a stronger contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assumption, capability, claim, contract, derive, fact, model, observation, publication, rule, s,
  type DnaContract } from "../src/index.ts";
import * as saas from "../examples/cross-domain/saas.ts";

const minimal = (): DnaContract => ({ dna: "1.0", id: "example:service", revision: "1", publisher: "example.invalid",
  authorities: [], entities: [{ id: "service", type: "service", revision: "1", name: "Example" }],
  capabilities: [{ id: "service.bookable", subject: "service", status: "available" }], claims: [], relations: [] });

test("KNOWN GAP G1: claim evidence registration does not enforce an approval predicate", () => {
  const approved = fact("editor.approved", s.boolean);
  const statement = claim("statement", { dependencies: { approved }, evidence: [approved], text: () => "Approved for distribution" });
  const page = publication("page", { kind: "website", path: "page.txt", mediaType: "text/plain",
    claims: [statement], dependencies: { text: statement.value }, render: ({ text }) => text });
  const m = model({ id: "claim-gap", version: "1", values: [page], checks: [rule("approved", { approved }, ({ approved }) => approved)] });
  const scenario = m.scenario("unapproved").set(approved, assumption(false, "Rejected approval"));
  assert.equal(scenario.evaluate().ok, false);
  const result = scenario.read(page);
  assert.equal(result.status, "known");
  if (result.status === "known") assert.equal(result.value.content, "Approved for distribution");
});

test("KNOWN GAP G2: observation labels carry time and scope but enforce neither freshness nor scope", () => {
  const availability = fact("availability", s.boolean);
  const m = model({ id: "staleness-gap", version: "1", checks: [rule("ready", { availability }, ({ availability }) => availability)] });
  const scenario = m.scenario("now").set(availability, observation(true, {
    source: "fixture:not-real-evidence", at: "2020-01-01T00:00:00Z", scope: "a different customer's old booking",
  }));
  assert.doesNotThrow(() => scenario.evaluate().assert({ requireObservations: true }));
});

test("KNOWN GAP G3: records from different periods conflict rather than becoming a time series", () => {
  const stock = fact("stock", s.number({ integer: true }));
  const m = model({ id: "history-gap", version: "1", values: [stock] });
  const scenario = m.scenario("history")
    .record(stock, observation(1, { source: "fixture:inventory", at: "2026-09-01T00:00:00Z", scope: "Monday" }))
    .record(stock, observation(0, { source: "fixture:inventory", at: "2026-09-02T00:00:00Z", scope: "Tuesday" }));
  assert.equal(scenario.read(stock).status, "conflict");
});

test("KNOWN GAP G4: unit labels do not prevent adding different currencies", () => {
  const euros = fact("euros", s.number(), { unit: "EUR cents" });
  const dollars = fact("dollars", s.number(), { unit: "USD cents" });
  const wrongTotal = derive("total", s.number(), { euros, dollars }, ({ euros, dollars }) => euros + dollars);
  const scenario = model({ id: "units-gap", version: "1", values: [wrongTotal] }).scenario("wrong-units")
    .set(euros, assumption(100, "Synthetic EUR")).set(dollars, assumption(100, "Synthetic USD"));
  const result = scenario.read(wrongTotal);
  assert.equal(result.status, "known");
  if (result.status === "known") assert.equal(result.value, 200);
});

test("KNOWN GAP G5: all dependencies resolve before a callback can short-circuit", () => {
  const active = fact("active", s.boolean);
  const credit = fact("credit", s.number());
  const canOrder = capability("can-order", { active, credit }, ({ active, credit }) => active && credit > 0);
  const scenario = model({ id: "eager-gap", version: "1", values: [canOrder.value] }).scenario("inactive")
    .set(active, assumption(false, "Known inactive, no credit snapshot"));
  assert.equal(scenario.read(canOrder.value).status, "unknown");
});

test("KNOWN GAP G6: the public capability cannot express actor/time/market qualifiers", () => {
  const withContext: unknown = { ...minimal(), capabilities: [{ ...minimal().capabilities[0], context: { market: "NL" } }] };
  assert.throws(() => contract(withContext as DnaContract), /unexpected property context/);
});

test("KNOWN GAP G7: public relation vocabulary rejects a domain-namespaced distribution relation", () => {
  const withRelation: unknown = { ...minimal(), relations: [{ from: "service", type: "example:licensed-for", to: "service.bookable" }] };
  assert.throws(() => contract(withRelation as DnaContract), /expected one of/);
});

test("KNOWN GAP G8: internal scenario export is not a privacy boundary", () => {
  assert.match(JSON.stringify(saas.baseline.toJSON()), /private-person@example.invalid/);
  const publicResult = saas.baseline.read(saas.pricing);
  assert.doesNotMatch(JSON.stringify(publicResult), /private-person@example.invalid/);
});
