import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assumption, type Scenario, type Value } from "../src/index.ts";
import * as m from "../examples/finance-strategy/model.ts";

function read<T>(scenario: Scenario, node: Value<T>): T {
  const result = scenario.read(node);
  if (result.status !== "known") throw new Error(`${scenario.name}/${node.id}: ${result.status}`);
  return result.value;
}
const variants = [
  ...m.scenarios,
  m.revenueFirst.fork("revenue-first-late-collections").set(m.delay, assumption(60, "Same collection shock for the other strategy")),
  m.revenueFirst.fork("revenue-first-no-conversions").set(m.opportunities, assumption([], "Same demand downside for the other strategy")),
];
const root = "reports/finance-strategy";
mkdirSync(root, { recursive: true });
const summaries = variants.map(scenario => {
  const report = scenario.evaluate();
  if (report.values.some(value => value.status !== "known")) throw new Error(`${scenario.name}: unexpected incomplete/erroring model`);
  const expectedPass = scenario === m.baseline;
  if (report.ok !== expectedPass) throw new Error(`${scenario.name}: unexpected overall gate result`);
  const f = read(scenario, m.statements);
  const summary = { scenario: scenario.name, currency: "USD", horizonDay: read(scenario, m.horizon),
    selected: read(scenario, m.plan).selected.map(order => order.id), revenueCents: f.revenueCents, profitCents: f.profitCents,
    minimumCashCents: read(scenario, m.cash.lowestBalance), closingCashCents: f.closingCashCents,
    receivablesCents: f.receivablesCents, financingGapCents: read(scenario, m.cash.fundingGap),
    checks: report.checks.map(check => ({ id: check.id, kind: check.kind, status: check.status, basis: check.basis })),
    changedSurfaces: m.surfaces.filter(surface => read(scenario, surface).content !== read(m.baseline, surface).content).map(surface => surface.id) };
  // Intentional internal previews, including infeasible plans; never deployment output.
  const dir = join(root, scenario.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report.toJSON(), null, 2) + "\n");
  for (const surface of m.surfaces) writeFileSync(join(dir, `${surface.id}.json`), read(scenario, surface).content + "\n");
  console.log(`${scenario.name}: revenue=${f.revenueCents / 100}; profit=${f.profitCents / 100}; min cash=${summary.minimumCashCents / 100} USD; ${report.ok ? "modeled goals/guards pass" : "counterexample reproduced"}`);
  return summary;
});
writeFileSync(join(root, "summary.json"), JSON.stringify({ synthetic: true, previewOnly: true, scenarios: summaries }, null, 2) + "\n");
writeFileSync(join(root, "model.json"), JSON.stringify(m.business.toJSON(), null, 2) + "\n");
