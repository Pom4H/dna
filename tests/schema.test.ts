import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { s, ValidationError, assumption, observation, model, fact } from "../src/index.ts";

const evidence = { source: "fixture://unit-test", at: "2026-01-01T00:00:00Z", scope: "test-only" };
describe("schemas and boundaries", () => {
  test("finite numbers, bounds and safe integer money", () => {
    const money = s.number({ integer: true, min: 0, max: 100 });
    assert.equal(money.parse(100), 100);
    for (const value of [NaN, Infinity, -Infinity, -1, 101, 1.5, "2", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => money.parse(value), ValidationError);
    }
    assert.equal(Object.is(money.parse(-0), -0), false);
  });
  test("invalid schema configuration is rejected", () => {
    assert.throws(() => s.number({ min: 10, max: 2 }));
    assert.throws(() => s.number({ min: NaN }));
    assert.throws(() => s.string({ minLength: -1 }));
    assert.throws(() => s.array(s.boolean, { maxLength: -1 }));
    assert.throws(() => s.enum("duplicate", "duplicate"));
  });
  test("strings and enums never coerce input", () => {
    const name = s.string({ minLength: 1, maxLength: 3 });
    assert.equal(name.parse("abc"), "abc");
    for (const value of ["", "long", 2]) assert.throws(() => name.parse(value));
    assert.equal(s.enum("usb2", "none").parse("none"), "none");
    assert.throws(() => s.enum("usb2", "none").parse("usb4"));
    assert.throws(() => s.boolean.parse("false"));
  });
  test("nested objects validate, copy, and freeze", () => {
    const schema = s.object({ flags: s.array(s.object({ enabled: s.boolean })) });
    const input = { flags: [{ enabled: true }] };
    const result = schema.parse(input);
    input.flags[0]!.enabled = false;
    assert.equal(result.flags[0]!.enabled, true);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.flags) && Object.isFrozen(result.flags[0]));
    assert.throws(() => schema.parse({ flags: [{ enabled: "yes" }] }), /\$input.flags\[0\].enabled/);
  });
  test("missing, inherited, extra and symbol properties are rejected", () => {
    const schema = s.object({ enabled: s.boolean });
    for (const value of [{}, { enabled: true, extra: 1 }, Object.create({ enabled: true }),
      { enabled: true, [Symbol("hidden")]: true }, new Date(), []]) assert.throws(() => schema.parse(value));
    assert.deepEqual(schema.parse(Object.assign(Object.create(null), { enabled: true })), { enabled: true });
    assert.throws(() => schema.parse(JSON.parse('{"enabled":true,"__proto__":{"polluted":true}}')));
    assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
  });
  test("arrays enforce bounds and reject holes", () => {
    const schema = s.array(s.number(), { minLength: 1, maxLength: 2 });
    assert.deepEqual(schema.parse([0, 1]), [0, 1]);
    for (const value of [[], [1, 2, 3], new Array(1), "[]"]) assert.throws(() => schema.parse(value));
  });
  test("provenance requires explicit, valid metadata", () => {
    assert.throws(() => assumption(1, " "));
    assert.throws(() => observation(1, { ...evidence, scope: "" }));
    assert.throws(() => observation(1, { ...evidence, source: "" }));
    for (const at of ["yesterday", "2026-02-30T00:00:00Z", "2026-01-01", "2026-01-01T25:00:00Z"]) {
      assert.throws(() => observation(1, { ...evidence, at }));
    }
    assert.equal(observation(1, evidence).provenance.kind, "observation");
    assert.doesNotThrow(() => observation(1, { ...evidence, at: "2026-01-01T00:00:00.123Z" }));
  });
  test("set validates even when TypeScript is bypassed by external data", () => {
    const n = fact("n", s.number({ integer: true }));
    const scenario = model({ id: "boundary", version: "1", values: [n] }).scenario("input");
    const external: unknown = "123";
    assert.throws(() => scenario.set(n, assumption(external as number, "Untrusted input test")), /expected finite number/);
  });
});
