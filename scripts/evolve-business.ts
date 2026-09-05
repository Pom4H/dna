import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { runExperiment } from "../examples/business-evolution/search.ts";

const started = performance.now();
console.log("Business evolution: 3 seeds × 96 candidates × 12 generations; equal-budget random search; 6 training + 6 held-out worlds.");
const result = runExperiment();
const elapsedSeconds = (performance.now() - started) / 1000;
const report = { ...result, execution: { elapsedSeconds, runtime: `Bun ${execFileSync(process.execPath, ["--version"], { encoding: "utf8" }).trim()}`,
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTree: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() } };
await mkdir("reports/business-evolution", { recursive: true });
await writeFile("reports/business-evolution/full.json", JSON.stringify(report, null, 2) + "\n");
const compact = { ...report, runs: report.runs.map(run => ({ seed: run.seed,
  evolution: { ...run.evolution, lineage: undefined }, random: { ...run.random, lineage: undefined } })) };
await writeFile("reports/business-evolution/summary.json", JSON.stringify(compact, null, 2) + "\n");
for (const run of result.runs) for (const search of [run.evolution, run.random]) console.log(JSON.stringify({
  method: search.method, seed: run.seed, evaluations: search.evaluations, unique: search.uniqueGenomes,
  trainingFeasible: search.winner.assessment.feasible, trainingNet: search.winner.assessment.meanNetCashCents,
  holdoutFeasible: search.holdout.feasible, holdoutNet: search.holdout.meanNetCashCents,
  genome: search.winner.genome, stress: search.stress.map(value => ({ market: value.market, feasible: value.feasible, net: value.meanNetCashCents })) }));
console.log(`Baseline holdout net: ${result.baseline.holdout.meanNetCashCents}; elapsed ${elapsedSeconds.toFixed(2)}s. Reports: reports/business-evolution/`);
