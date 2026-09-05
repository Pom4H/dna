import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import * as saas from "../examples/cross-domain/saas.ts";
import * as services from "../examples/cross-domain/services.ts";
import * as publishing from "../examples/cross-domain/publishing.ts";
import * as reservations from "../examples/cross-domain/reservations.ts";

const root = resolve("reports/domain-stress");
mkdirSync(root, { recursive: true });
const results = [];
for (const domain of [saas, services, publishing, reservations]) {
  domain.baseline.evaluate().assert();
  const initial = domain.baseline.toJSON().assertions;
  for (const scenario of domain.scenarios) {
    const current = scenario.toJSON().assertions;
    const changedFacts = domain.business.definitions.filter(node => node.kind === "fact"
      && JSON.stringify(initial[node.id]) !== JSON.stringify(current[node.id]));
    const surfaceChanges = [];
    for (const surface of domain.surfaces) {
      const before = domain.baseline.read(surface);
      const after = scenario.read(surface);
      const changed = before.status !== after.status || (before.status === "known" && after.status === "known"
        && before.value.content !== after.value.content);
      surfaceChanges.push({ id: surface.id, changed, status: after.status, basis: after.basis });
      if (after.status === "known") {
        // Only previews, including intentionally failing scenarios. Never deployment output.
        const file = resolve(root, "previews", scenario.name, after.value.path);
        if (!file.startsWith(root + sep)) throw new Error("Preview path escapes report directory");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, after.value.content);
      }
    }
    const report = scenario.evaluate();
    results.push({ model: domain.business.id, scenario: scenario.name, previewOnly: true,
      modelGatePassed: report.ok, changedFacts: changedFacts.map(node => node.id),
      candidateImpact: domain.business.impact(...changedFacts), surfaceChanges,
      checks: report.checks.map(check => ({ id: check.id, status: check.status, basis: check.basis })),
    });
    console.log(`${domain.business.id}/${scenario.name}: ${surfaceChanges.filter(item => item.changed).length}/${surfaceChanges.length} surfaces changed; model gate ${report.ok ? "pass" : "fail (expected counterexample)"}`);
  }
}
writeFileSync(resolve(root, "summary.json"), JSON.stringify({
  format: "dna.cross-domain-experiment/v1", synthetic: true, previewOnly: true,
  meaning: "Model consistency, not business validity, legal clearance or transactional safety",
  knownGapTests: "tests/known-gaps.test.ts",
  findings: "docs/cross-domain-findings.md", scenarios: results,
}, null, 2) + "\n");
console.log("Preview report written to reports/domain-stress; not a public contract or deployment.");
