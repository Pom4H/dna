import { mkdir, writeFile } from "node:fs/promises";
import { dna as subscription, baseline } from "../examples/subscription.ts";
import { dna as firmware } from "../examples/firmware.ts";
import { dna as cashflow, growth } from "../examples/cashflow.ts";
await mkdir("reports", { recursive: true });
await Promise.all([
  writeFile("reports/subscription.model.json", JSON.stringify(subscription, null, 2) + "\n"),
  writeFile("reports/cashflow.model.json", JSON.stringify(cashflow, null, 2) + "\n"),
  writeFile("reports/growth.report.json", JSON.stringify(growth.evaluate(), null, 2) + "\n"),
  writeFile("reports/firmware.model.json", JSON.stringify(firmware, null, 2) + "\n"),
  writeFile("reports/baseline.report.json", JSON.stringify(baseline.evaluate(), null, 2) + "\n"),
]);
console.log("Wrote reviewable model IR and scenario report to reports/");
