import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineGenome, simulateMarket, acceptContract, assess, trainingMarkets } from "../examples/business-evolution/model.ts";
import { search, runExperiment } from "../examples/business-evolution/search.ts";

test("evolution counterexample: profitable shortcuts cannot erase delivery requirements", () => {
  const shortcut = { ...baselineGenome, installationHours: 4 };
  const results = trainingMarkets.map(market => simulateMarket(shortcut, market).focal);
  const evaluation = assess(shortcut, results);
  assert.equal(evaluation.feasible, false);
  assert.equal(evaluation.decisions.find(check => check.id === "evolution.quality")?.status, "fail");
});

test("evolution counterexample: annual subscription income cannot pay today's hardware bill", () => {
  const service = { ...baselineGenome, payment: "service" as const, support: "lean" as const, depositPercent: 0 };
  const world = { ...trainingMarkets[0]!, openingCashCents: 0, fixedMonthlyCents: 0 };
  const result = simulateMarket(service, world).focal;
  assert.equal(result.orders, 0);
  assert.ok(result.fundingRejected > 0);
  assert.equal(result.minimumCashCents, 0);
});

test("accepted cohorts retain prices, quality and support after the genome changes", () => {
  const genome = { ...baselineGenome };
  const contract = acceptContract("fictional-buyer", 0, genome);
  const before = JSON.stringify(contract);
  genome.monthlyCents = 36_000;
  genome.installationHours = 4;
  genome.support = "lean";
  assert.equal(JSON.stringify(contract), before);
  assert.equal(contract.terms.monthlyCents, 15_000);
  assert.ok(Object.isFrozen(contract.terms));
  const first = simulateMarket(baselineGenome, trainingMarkets[0]!, { changeAtMonth: 6, next: genome, trace: true });
  assert.ok(first.focal.contracts.some(order => order.month < 6));
  assert.ok(first.focal.contracts.filter(order => order.month < 6).every(order => order.terms.monthlyCents === 15_000));
});

test("the market is reproducible, shares scarce resources and runs off all obligations", () => {
  const market = { ...trainingMarkets[0]!, kitsPerMonth: 1, installerHoursPerMonth: 8 };
  const first = simulateMarket(baselineGenome, market, { trace: true });
  assert.deepEqual(first, simulateMarket(baselineGenome, market, { trace: true }));
  assert.equal(first.resourceOverdraw, 0);
  assert.ok(first.companies.some(company => company.capacityRejected > 0));
  for (const company of first.companies) {
    assert.equal(company.openObligations, 0);
    assert.equal(company.finalCashCents, trainingMarkets[0]!.openingCashCents + company.cashMovementsCents);
    assert.ok(company.minimumCashCents <= company.finalCashCents);
    assert.ok(company.months.at(-1)!.activeContracts === 0);
  }
});

test("a missing simulation is unknown, never a zero-loss feasible business", () => {
  const result = assess(baselineGenome, []);
  assert.equal(result.feasible, false);
  assert.equal(result.scoreCents, null);
  assert.equal(result.decisions.find(check => check.id === "evolution.solvency")?.status, "unknown");
});

test("search preserves elite fitness, records lineage and gives both algorithms the same budget", () => {
  const options = { seed: 31, population: 16, generations: 4, markets: trainingMarkets.slice(0, 2) };
  const genetic = search("evolution", options);
  const random = search("random", options);
  assert.equal(genetic.evaluations, 64);
  assert.equal(random.evaluations, genetic.evaluations);
  assert.equal(genetic.simulations, random.simulations);
  assert.ok(genetic.history.slice(1).every((entry, i) => {
    const previous = genetic.history[i]!;
    return (entry.bestFeasible && !previous.bestFeasible) ||
      (entry.bestFeasible === previous.bestFeasible && entry.bestScoreCents >= previous.bestScoreCents);
  }));
  assert.ok(genetic.lineage.some(entry => entry.parents.length > 0));
  assert.deepEqual(genetic, search("evolution", options));
});

test("holdout is evaluated only after training selection and cannot choose the winner", () => {
  const options = { seeds: [41], population: 12, generations: 3, markets: trainingMarkets.slice(0, 1) };
  const ordinary = runExperiment({ ...options, holdout: trainingMarkets.slice(1, 2) });
  const hostile = runExperiment({ ...options, holdout: [{ ...trainingMarkets[1]!, openingCashCents: 0 }] });
  assert.deepEqual(ordinary.runs[0]!.evolution.winner, hostile.runs[0]!.evolution.winner);
  assert.deepEqual(ordinary.runs[0]!.random.winner, hostile.runs[0]!.random.winner);
  assert.equal(hostile.runs[0]!.evolution.holdout.feasible, false);
  assert.equal(ordinary.evidence, "synthetic-assumptions");
});
