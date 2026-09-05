import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("..", import.meta.url));
function run(...args: string[]) {
  const flags = process.versions["bun"] ? [] : ["--experimental-transform-types"];
  const result = spawnSync(process.execPath, [...flags, "src/cli.ts", ...args], { cwd, encoding: "utf8", timeout: 15_000 });
  assert.equal(result.error, undefined);
  return result;
}
test("CLI: a modeled baseline passes", () => {
  const result = run("examples/subscription.ts");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /conditional; assumptions/);
});
test("CLI: the observations-only gate rejects a synthetic baseline", () => {
  const result = run("examples/subscription.ts", "--observed");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires observations/);
});
test("CLI: JSON has explicit reports and gate outcomes", () => {
  const result = run("examples/subscription.ts", "--json", "--observed");
  const json = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(json.reports[0].ok, true);
  assert.equal(json.gates[0].passed, false);
});
test("CLI: bad flags, absent exports and missing files are usage/input errors", () => {
  assert.equal(run("examples/subscription.ts", "--typo").status, 2);
  assert.equal(run("src/index.ts").status, 2);
  assert.equal(run("examples/does-not-exist.ts").status, 2);
});
test("CLI: help succeeds and no arguments fail", () => {
  assert.equal(run("--help").status, 0);
  assert.equal(run().status, 2);
});
