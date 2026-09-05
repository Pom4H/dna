import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { evaluate, exhaustiveSearch, runExperiment } from "../examples/business-evolution/search.ts";
import { holdoutMarkets, simulateMarket, stressMarkets, trainingMarkets, type Assessment } from "../examples/business-evolution/model.ts";

const started = performance.now();
const sourcePaths = ["examples/business-evolution/model.ts", "examples/business-evolution/search.ts", "scripts/evolve-business.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
console.log("Business evolution v2: 3 seeds × 96 candidates × 12 generations; equal-budget random search; 8 training + 6 fresh held-out worlds.");
const result = runExperiment({ onRun: seed => console.log(`Search seed ${seed} complete.`) });
console.log("Enumerating all 6,912 policies as an exact finite-grid control.");
const enumerated = exhaustiveSearch(trainingMarkets);
const exhaustive = { ...enumerated, holdout: evaluate(enumerated.winner.genome, holdoutMarkets),
  stress: stressMarkets.map(market => ({ market: market.id, ...evaluate(enumerated.winner.genome, [market]) })) };
const elapsedSeconds = (performance.now() - started) / 1000;
const report = { ...result, exhaustive, execution: { elapsedSeconds, runtime: `Bun ${execFileSync(process.execPath, ["--version"], { encoding: "utf8" }).trim()}`,
  baseRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceHashes,
  workingTree: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() } };
await mkdir("reports/business-evolution", { recursive: true });
await writeFile("reports/business-evolution/full.json", JSON.stringify(report, null, 2) + "\n");
const compact = { ...report, runs: report.runs.map(run => ({ seed: run.seed,
  evolution: { ...run.evolution, lineage: undefined }, random: { ...run.random, lineage: undefined } })) };
await writeFile("reports/business-evolution/summary.json", JSON.stringify(compact, null, 2) + "\n");
const metrics = (value: Assessment) => ({ feasible: value.feasible, scoreCents: value.scoreCents,
  meanNetCashCents: value.meanNetCashCents, worstNetCashCents: value.worstNetCashCents,
  minimumCashCents: value.minimumCashCents, meanOrders: value.meanOrders });
const recorded = { format: report.format, evidence: report.evidence, execution: report.execution,
  population: report.population, generations: report.generations, seeds: report.seeds, objective: report.objective,
  trainingSeeds: trainingMarkets.map(market => market.seed), holdoutSeeds: holdoutMarkets.map(market => market.seed),
  baseline: { genome: report.baseline.genome, training: metrics(report.baseline.training), holdout: metrics(report.baseline.holdout) },
  runs: report.runs.flatMap(run => [run.evolution, run.random].map(value => ({ method: value.method, seed: run.seed,
    evaluations: value.evaluations, simulations: value.simulations, uniqueGenomes: value.uniqueGenomes, genome: value.winner.genome,
    training: metrics(value.winner.assessment), holdout: metrics(value.holdout),
    stress: value.stress.map(stress => ({ market: stress.market, ...metrics(stress) })),
    convergence: value.history.map(entry => ({ generation: entry.generation, evaluated: entry.evaluated,
      feasible: entry.bestFeasible, scoreCents: entry.bestScoreCents })) }))),
  exhaustive: { evaluations: exhaustive.evaluations, simulations: exhaustive.simulations, feasibleCount: exhaustive.feasibleCount,
    scope: exhaustive.scope, genome: exhaustive.winner.genome, training: metrics(exhaustive.winner.assessment), holdout: metrics(exhaustive.holdout),
    stress: exhaustive.stress.map(stress => ({ market: stress.market, ...metrics(stress) })) } };
await writeFile("reports/business-evolution/recorded.json", JSON.stringify(recorded, null, 2) + "\n");
await writeFile("reports/business-evolution/selected-policy-traces.json", JSON.stringify(holdoutMarkets.map(market =>
  simulateMarket(exhaustive.winner.genome, market, { trace: true })), null, 2) + "\n");
for (const run of result.runs) for (const search of [run.evolution, run.random]) console.log(JSON.stringify({
  method: search.method, seed: run.seed, evaluations: search.evaluations, unique: search.uniqueGenomes,
  trainingFeasible: search.winner.assessment.feasible, trainingNet: search.winner.assessment.meanNetCashCents,
  holdoutFeasible: search.holdout.feasible, holdoutNet: search.holdout.meanNetCashCents,
  genome: search.winner.genome, stress: search.stress.map(value => ({ market: value.market, feasible: value.feasible, net: value.meanNetCashCents })) }));
console.log(`Baseline holdout net: ${result.baseline.holdout.meanNetCashCents}; elapsed ${elapsedSeconds.toFixed(2)}s. Reports: reports/business-evolution/`);
console.log(JSON.stringify({ exhaustive: exhaustive.winner.genome, training: metrics(exhaustive.winner.assessment), holdout: metrics(exhaustive.holdout) }));
