import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fact, model, s } from "../src/index.ts";
import { snapshot } from "../examples/cross-domain/snapshots.ts";

test("snapshot adapter rereads authority bytes; previous scenarios remain reproducible", () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-source-"));
  try {
    const file = join(dir, "upstream.json");
    const price = fact("price", s.number({ integer: true }));
    const m = model({ id: "read-only-adapter", version: "1", values: [price] });
    const shape = s.object({ price: s.number({ integer: true }) });
    writeFileSync(file, '{"price":100}');
    const before = snapshot(pathToFileURL(file), shape);
    const scenarioA = m.scenario("A").set(price, before.input(before.data.price, "catalog"));
    writeFileSync(file, '{"price":200}');
    const after = snapshot(pathToFileURL(file), shape);
    const scenarioB = m.scenario("B").set(price, after.input(after.data.price, "catalog"));
    assert.notEqual(before.digest, after.digest);
    const a = scenarioA.read(price);
    const b = scenarioB.read(price);
    assert.equal(a.status === "known" && a.value, 100);
    assert.equal(b.status === "known" && b.value, 200);
    assert.equal(readFileSync(file, "utf8"), '{"price":200}');
    writeFileSync(file, '{"price":"invalid"}');
    assert.throws(() => snapshot(pathToFileURL(file), shape), /number/);
    assert.equal(a.basis, "assumptions");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
