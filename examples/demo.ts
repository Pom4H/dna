import { baseline, downside, breakEven } from "./subscription.ts";
import { baseline as firmware, operator, noData, dna, port } from "./firmware.ts";
import { empty, synthetic } from "./pilot.ts";

for (const scenario of [baseline, downside, breakEven, firmware, operator, noData, empty, synthetic]) {
  const report = scenario.evaluate();
  console.log(`\n${report.model} / ${report.scenario}`);
  for (const check of report.checks) console.log(`  ${check.status.toUpperCase().padEnd(8)} ${check.id} [${check.conclusion}; ${check.basis}]`);
}
console.log("\nChanging port.data impacts:", dna.impact(port.fields.data).join(" -> "));
