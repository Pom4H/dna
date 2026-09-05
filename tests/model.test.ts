import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fact, derive, rule, hypothesis, model, s, assumption, observation, entity,
  inconclusive, type Computed, type Check, type Dependencies, type PredicateResult } from "../src/index.ts";

// Fabricated metadata tests engine semantics only, never empirical business claims.
const evidence = { source: "fixture://unit-test", at: "2026-01-01T00:00:00Z", scope: "synthetic-unit-test" };
function fixture() {
  const n = fact("sample.n", s.number({ integer: true }));
  const doubled = derive("sample.doubled", s.number({ integer: true }), { n }, ({ n }) => n * 2);
  const positive = hypothesis("sample.positive", { doubled }, ({ doubled }) => doubled > 0);
  const dna = model({ id: "sample", version: "1", checks: [positive] });
  return { n, doubled, positive, dna };
}

describe("knowledge and immutable scenarios", () => {
  test("unknown is not false and propagates through calculations and checks", () => {
    const { dna, doubled } = fixture();
    const scenario = dna.scenario("empty");
    assert.equal(scenario.read(doubled).status, "unknown");
    assert.equal(scenario.evaluate().checks[0]!.status, "unknown");
    assert.throws(() => scenario.evaluate().assert(), /unknown/);
  });
  test("a known false boolean stays known", () => {
    const b = fact("b", s.boolean);
    const check = rule("must-be-false", { b }, ({ b }) => b === false);
    const scenario = model({ id: "bool", version: "1", checks: [check] }).scenario("false").set(b, assumption(false, "Explicit false"));
    assert.equal(scenario.read(b).status, "known");
    scenario.evaluate().assert();
  });
  test("derivations are typed, traced and validated", () => {
    const { n, doubled, dna } = fixture();
    const value = dna.scenario("three").set(n, assumption(3, "Test value")).read(doubled);
    assert.equal(value.status, "known");
    if (value.status === "known") assert.equal(value.value, 6);
    assert.equal(value.origins[0]!.fact, n.id);
  });
  test("hypotheses depending on assumptions remain conditional", () => {
    const { n, dna } = fixture();
    const report = dna.scenario("assumed").set(n, assumption(3, "Forecast")).evaluate();
    assert.equal(report.checks[0]!.conclusion, "conditional");
    assert.equal(report.checks[0]!.basis, "assumptions");
    report.assert();
    assert.throws(() => report.assert({ requireObservations: true }), /requires observations/);
  });
  test("observed support and refutation are both explicit", () => {
    const { n, dna } = fixture();
    const yes = dna.scenario("yes").set(n, observation(3, evidence)).evaluate();
    yes.assert({ requireObservations: true });
    assert.equal(yes.checks[0]!.conclusion, "supported");
    const no = dna.scenario("no").set(n, observation(-1, evidence)).evaluate();
    assert.equal(no.checks[0]!.status, "fail");
    assert.equal(no.checks[0]!.conclusion, "refuted");
  });
  test("adding an observation never silently promotes an assumption", () => {
    const { n, dna } = fixture();
    const mixed = dna.scenario("mixed").set(n, assumption(3, "Prior estimate")).record(n, observation(3, evidence));
    assert.equal(mixed.evaluate().checks[0]!.basis, "mixed");
    assert.equal(mixed.evaluate().checks[0]!.conclusion, "conditional");
    const resolved = mixed.fork("reviewed").set(n, observation(3, evidence));
    resolved.evaluate().assert({ requireObservations: true });
    assert.equal(mixed.evaluate().checks[0]!.basis, "mixed");
  });
  test("conflicting assertions are never last-write-wins", () => {
    const { n, doubled, dna } = fixture();
    const conflict = dna.scenario("conflict").record(n, observation(1, evidence))
      .record(n, observation(2, { ...evidence, source: "fixture://second-source" }));
    assert.equal(conflict.read(n).status, "conflict");
    assert.equal(conflict.read(doubled).status, "conflict");
    assert.equal(conflict.evaluate().checks[0]!.status, "conflict");
    assert.throws(() => conflict.evaluate().assert(), /conflict/);
    assert.equal(conflict.toJSON().assertions[n.id]!.length, 2);
  });
  test("equivalent objects from different sources do not conflict", () => {
    const point = fact("point", s.object({ x: s.number(), y: s.number() }));
    const dna = model({ id: "point", version: "1", values: [point] });
    const scenario = dna.scenario("equal").record(point, observation({ x: 1, y: 2 }, evidence))
      .record(point, observation({ y: 2, x: 1 }, { ...evidence, source: "fixture://second" }));
    assert.equal(scenario.read(point).status, "known");
  });
  test("fork and set leave parents and sibling scenarios untouched", () => {
    const { n, doubled, dna } = fixture();
    const empty = dna.scenario("empty");
    const base = empty.set(n, assumption(5, "Base"));
    const sibling = base.fork("sibling").set(n, assumption(9, "Alternative"));
    assert.equal(empty.read(n).status, "unknown");
    assert.deepEqual(base.read(doubled).status === "known" && base.read(doubled), base.read(doubled));
    const a = base.read(n), b = sibling.read(n);
    assert.ok(a.status === "known" && a.value === 5);
    assert.ok(b.status === "known" && b.value === 9);
  });
  test("input mutation after set cannot change a scenario", () => {
    const values = fact("values", s.array(s.object({ n: s.number() })));
    const dna = model({ id: "freeze", version: "1", values: [values] });
    const data = [{ n: 1 }];
    const scenario = dna.scenario("frozen").set(values, assumption(data, "Mutable caller input"));
    data[0]!.n = 99;
    const result = scenario.read(values);
    assert.ok(result.status === "known" && result.value[0]!.n === 1);
  });
  test("missing dependencies prevent predicate execution", () => {
    let called = false;
    const missing = fact("missing", s.boolean);
    const check = rule("short-circuit", { missing }, () => { called = true; return true; });
    model({ id: "conservative", version: "1", checks: [check] }).scenario("empty").evaluate();
    assert.equal(called, false);
  });
  test("shared derivations execute once per evaluation", () => {
    let calls = 0;
    const n = fact("n", s.number());
    const next = derive("next", s.number(), { n }, ({ n }) => { calls++; return n + 1; });
    const a = rule("a", { next }, ({ next }) => next > 0);
    const b = rule("b", { next }, ({ next }) => next < 10);
    const scenario = model({ id: "memo", version: "1", checks: [a, b] }).scenario("one").set(n, assumption(1, "Test"));
    scenario.evaluate().assert(); assert.equal(calls, 1);
    scenario.evaluate().assert(); assert.equal(calls, 2);
  });
});

describe("graph validation, errors and reports", () => {
  test("duplicate IDs with different definitions are rejected", () => {
    assert.throws(() => model({ id: "collision", version: "1", values: [fact("same", s.boolean), fact("same", s.number())] }), /Duplicate definition/);
  });
  test("shared exact definitions are allowed", () => {
    const { dna, n } = fixture();
    assert.equal(dna.definitions.filter(node => node === n).length, 1);
  });
  test("foreign definitions and unregistered dependencies cannot be set", () => {
    const { dna } = fixture();
    assert.throws(() => dna.scenario("bad").set(fact("sample.n", s.number()), assumption(1, "Forged same ID")), /does not belong/);
    assert.throws(() => dna.impact(fact("unknown", s.number())), /does not belong/);
  });
  test("cycles are detected at model compilation", () => {
    const dependencies: Record<string, Computed<number>> = {};
    const cyclic: Computed<number> = { kind: "computed", id: "loop", schema: s.number(), metadata: {}, dependencies, compute: () => 0 };
    dependencies["self"] = cyclic;
    assert.throws(() => model({ id: "cyclic", version: "1", values: [cyclic] }), /Dependency cycle: loop -> loop/);
  });
  test("duplicate entities and entity/definition collisions are rejected", () => {
    const e = entity("e", { type: "fixture", version: "1", fields: { n: s.number() } });
    assert.throws(() => model({ id: "dup", version: "1", entities: [e, e] }), /Duplicate entity/);
    assert.throws(() => model({ id: "dup", version: "1", entities: [e], values: [fact("e", s.number())] }), /collision/);
  });
  test("derived overflow becomes an error, not an impossible numeric fact", () => {
    const n = fact("n", s.number());
    const huge = derive("huge", s.number(), { n }, ({ n }) => n * Number.MAX_VALUE);
    const check = hypothesis("finite", { huge }, ({ huge }) => huge > 0);
    const report = model({ id: "overflow", version: "1", checks: [check] }).scenario("overflow").set(n, assumption(2, "Overflow fixture")).evaluate();
    assert.equal(report.checks[0]!.status, "error");
    assert.throws(() => report.assert(), /finite number/);
  });
  test("throwing predicates are reported and do not erase other checks", () => {
    const broken = rule("broken", {}, () => { throw new Error("predicate bug"); });
    const good = rule("good", {}, () => true);
    const report = model({ id: "errors", version: "1", checks: [broken, good] }).scenario("test").evaluate();
    assert.equal(report.checks[0]!.status, "error");
    assert.equal(report.checks[1]!.status, "pass");
  });
  test("non-boolean truthy return values and async predicates are errors", () => {
    const make = (value: unknown) => rule("bad", {}, (() => value) as () => PredicateResult);
    for (const value of ["false", 1, undefined, Promise.resolve(true)]) {
      const report = model({ id: "bad", version: "1", checks: [make(value)] }).scenario("bad").evaluate();
      assert.equal(report.checks[0]!.status, "error");
    }
  });
  test("an explicit inconclusive verdict stays inconclusive", () => {
    const check = hypothesis("sample-size", {}, () => inconclusive("Not enough trials"));
    const report = model({ id: "pilot", version: "1", checks: [check] }).scenario("small").evaluate();
    assert.equal(report.checks[0]!.status, "unknown");
    assert.equal(report.checks[0]!.message, "Not enough trials");
  });
  test("an empty suite does not pass", () => {
    const report = model({ id: "empty", version: "1" }).scenario("empty").evaluate();
    assert.equal(report.ok, false);
    assert.throws(() => report.assert(), /No checks/);
  });
  test("constant hypotheses have no observational basis", () => {
    const h = hypothesis("tautology", {}, () => true);
    const report = model({ id: "constant", version: "1", checks: [h] }).scenario("constant").evaluate();
    assert.equal(report.checks[0]!.conclusion, "conditional");
    assert.throws(() => report.assert({ requireObservations: true }));
  });
  test("complete gates catch unused unknown fields", () => {
    const n = fact("unused", s.number());
    const pass = rule("pass", {}, () => true);
    const report = model({ id: "incomplete", version: "1", values: [n], checks: [pass] }).scenario("empty").evaluate();
    report.assert();
    assert.throws(() => report.assert({ requireComplete: true }), /unused: unknown/);
  });
  test("impact follows transitive dependencies and does not claim hidden closure analysis", () => {
    const { dna, n, doubled, positive } = fixture();
    assert.deepEqual(dna.impact(n), [doubled.id, positive.id]);
    assert.deepEqual(dna.impact(positive), []);
  });
  test("IR and reports serialize without functions and with model version/provenance", () => {
    const { n, dna } = fixture();
    const report = dna.scenario("audit").set(n, assumption(3, "Traceable reason")).evaluate();
    const serialized = JSON.stringify(report);
    assert.ok(serialized.includes("Traceable reason"));
    assert.equal(JSON.parse(serialized).version, "1");
    assert.equal(dna.toJSON().format, "dna.model/v1");
    assert.equal(dna.toJSON().definitions.length, 3);
    assert.equal(JSON.stringify(dna), JSON.stringify(dna));
    assert.ok(!JSON.stringify(dna).includes("=>"));
  });
  test("checks cannot be passed as value dependencies by untyped callers", () => {
    const a = rule("a", {}, () => true);
    const b: Check = { ...a, id: "b", dependencies: { a } as unknown as Dependencies };
    assert.throws(() => model({ id: "invalid-edge", version: "1", checks: [b] }), /checks cannot be value dependencies/);
  });
});
