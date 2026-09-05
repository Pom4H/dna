import assert from "node:assert/strict";
// A dynamic path keeps typechecking independent of a previous build.
const build = new URL("../dist/index.js", import.meta.url).href;
const { fact, s, model, rule, assumption } = await import(build) as typeof import("../src/index.ts");
const value = fact("smoke.value", s.boolean);
const check = rule("smoke.check", { value }, ({ value }) => value);
model({ id: "smoke", version: "0", checks: [check] }).scenario("built-js")
  .set(value, assumption(true, "Built JavaScript package smoke test")).evaluate().assert();
assert.equal(typeof s.object, "function");
console.log("Built ESM entrypoint smoke test passed");
