#!/usr/bin/env bun
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Scenario } from "./model.ts";

const args = process.argv.slice(2);
const usage = "Usage: bun src/cli.ts <trusted-model.ts> [--json] [--observed] [--complete]";
if (args.length === 1 && args[0] === "--help") {
  console.log(usage);
} else if (!args[0] || args[0].startsWith("--") || args.slice(1).some(arg => !["--json", "--observed", "--complete"].includes(arg))) {
  console.error(usage); process.exitCode = 2;
} else {
  try {
    // Import executes arbitrary trusted TypeScript. This is intentionally not a sandbox.
    const imported: unknown = await import(pathToFileURL(resolve(args[0])).href);
    const scenarios: unknown = (imported as Record<string, unknown>)["scenarios"];
    if (!Array.isArray(scenarios) || scenarios.length === 0 || scenarios.some(scenario => !(scenario instanceof Scenario))) {
      throw new Error("Model module must export a non-empty scenarios: Scenario[] array");
    }
    const reports = (scenarios as Scenario[]).map(scenario => scenario.evaluate());
    const options = { requireObservations: args.includes("--observed"), requireComplete: args.includes("--complete") };
    const gates = reports.map(report => {
      try { report.assert(options); return { scenario: report.scenario, passed: true }; }
      catch (error) { return { scenario: report.scenario, passed: false, message: error instanceof Error ? error.message : String(error) }; }
    });
    if (args.includes("--json")) console.log(JSON.stringify({ reports, gates }, null, 2));
    else {
      for (const report of reports) {
        console.log(`${report.model}@${report.version} / ${report.scenario}`);
        for (const check of report.checks) console.log(`  ${check.status.toUpperCase()} ${check.id} [${check.conclusion}; ${check.basis}] ${check.message}`);
      }
      for (const gate of gates) if (!gate.passed) console.error(gate.message);
    }
    if (gates.some(gate => !gate.passed)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2;
  }
}
