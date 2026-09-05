import { assess, baselineGenome, draw, genomeSchema, holdoutMarkets, simulateMarket, stressMarkets, trainingMarkets,
  type Assessment, type Genome, type Market } from "./model.ts";

// Finite, auditable interventions. The optimizer cannot mutate its fitness or invariants.
export const genes = {
  channel: ["direct", "partner"], payment: ["purchase", "service"],
  entryPriceCents: [180_000, 240_000, 300_000, 360_000], monthlyCents: [12_000, 15_000, 24_000, 36_000],
  depositPercent: [0, 50, 100], installationHours: [4, 6, 8],
  component: ["standard", "rugged"], support: ["lean", "staffed"],
} as const;
type Gene = keyof typeof genes;
const keys = Object.keys(genes) as Gene[];
export function fingerprint(genome: Genome) { return keys.map(key => String(genome[key])).join("/"); }
type Candidate = { id: string; genome: Genome; assessment: Assessment; parents: string[]; origin: "baseline" | "random" | "mutation" };
type SearchOptions = { seed: number; population: number; generations: number; markets: readonly Market[] };
function rank(a: Candidate, b: Candidate) {
  return Number(b.assessment.feasible) - Number(a.assessment.feasible) ||
    (b.assessment.scoreCents ?? -Infinity) - (a.assessment.scoreCents ?? -Infinity) || a.id.localeCompare(b.id);
}
export function evaluate(genome: Genome, markets: readonly Market[]) {
  return assess(genome, markets.map(market => simulateMarket(genome, market).focal));
}

export function search(method: "evolution" | "random", options: SearchOptions) {
  const { seed, population, generations, markets } = options;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff || !Number.isInteger(population) || population < 8 || population > 1_000 ||
    !Number.isInteger(generations) || generations < 1 || generations > 100 || markets.length === 0) throw new Error("Invalid search budget or empty training worlds");
  let counter = 0;
  const random = () => draw(seed, ++counter, 314159);
  const choose = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const randomGenome = (): Genome => genomeSchema.parse(Object.fromEntries(keys.map(key => [key, choose(genes[key] as readonly (string | number)[])])));
  const history: { generation: number; evaluated: number; uniqueGenomes: number; feasibleCandidates: number; bestFeasible: boolean; bestScoreCents: number; winnerId: string; winner: Genome }[] = [];
  const lineage: { id: string; genome: Genome; parents: string[]; origin: Candidate["origin"]; feasible: boolean; scoreCents: number | null }[] = [];
  const seen = new Set<string>();
  let elite: Candidate[] = [];
  let best: Candidate | undefined;
  let feasibleCandidates = 0;
  for (let generation = 0; generation < generations; generation++) {
    const batch: Candidate[] = [];
    for (let i = 0; i < population; i++) {
      let genome: Genome;
      let parents: string[] = [];
      let origin: Candidate["origin"] = "random";
      if (generation === 0 && i === 0) { genome = baselineGenome; origin = "baseline"; }
      else if (method === "evolution" && elite.length && i >= Math.ceil(population / 4)) {
        const a = choose(elite);
        const b = choose(elite);
        parents = [a.id, b.id];
        // Uniform crossover + at least one changed locus. 25% fresh immigrants retain diversity.
        const child: Record<string, string | number> = Object.fromEntries(keys.map(key => [key, (random() < 0.5 ? a : b).genome[key]]));
        const changed = choose(keys);
        for (const key of keys) if (key === changed || random() < 0.15) {
          child[key] = choose((genes[key] as readonly (string | number)[]).filter(value => value !== child[key]));
        }
        genome = genomeSchema.parse(child);
        origin = "mutation";
      } else genome = randomGenome();
      const id = `${method}-${seed}-g${generation}-n${i}`;
      const assessment = evaluate(genome, markets);
      const candidate = { id, genome, assessment, parents, origin };
      batch.push(candidate);
      seen.add(fingerprint(genome));
      feasibleCandidates += Number(assessment.feasible);
      lineage.push({ id, genome, parents, origin, feasible: assessment.feasible, scoreCents: assessment.scoreCents });
    }
    // Archived elite is not re-evaluated or charged against either algorithm's budget.
    const ranked = [...elite, ...batch].sort(rank);
    if (!best || rank(ranked[0]!, best) < 0) best = ranked[0]!;
    const unique = new Set<string>();
    elite = ranked.filter(candidate => {
      const key = fingerprint(candidate.genome);
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    }).slice(0, Math.max(2, Math.floor(population / 8)));
    history.push({ generation, evaluated: (generation + 1) * population, uniqueGenomes: seen.size,
      feasibleCandidates, bestFeasible: best.assessment.feasible, bestScoreCents: best.assessment.scoreCents ?? -Infinity, winnerId: best.id, winner: best.genome });
  }
  return { method, seed, evaluations: population * generations, simulations: population * generations * markets.length,
    uniqueGenomes: seen.size, winner: best!, history, lineage };
}

export function runExperiment(options: { seeds?: readonly number[]; population?: number; generations?: number;
  markets?: readonly Market[]; holdout?: readonly Market[] } = {}) {
  const seeds = options.seeds ?? [17, 37, 73];
  if (seeds.length === 0) throw new Error("At least one search seed is required");
  const markets = options.markets ?? trainingMarkets;
  const holdout = options.holdout ?? holdoutMarkets;
  const population = options.population ?? 96;
  const generations = options.generations ?? 12;
  const runs = seeds.map(seed => {
    // No holdout result is available to either search or to parent selection.
    const evolutionary = search("evolution", { seed, population, generations, markets });
    const random = search("random", { seed, population, generations, markets });
    const complete = (result: ReturnType<typeof search>) => ({ ...result,
      holdout: evaluate(result.winner.genome, holdout),
      stress: stressMarkets.map(market => ({ market: market.id, ...evaluate(result.winner.genome, [market]) })) });
    return { seed, evolution: complete(evolutionary), random: complete(random) };
  });
  return { format: "dna.business-evolution/v0.1", evidence: "synthetic-assumptions", population, generations, seeds,
    horizon: { acquisitionMonths: 12, runoffMonths: 12, contractMonths: 12 },
    objective: "Feasibility first, then 0.5 * mean net cash + 0.5 * worst net cash on training worlds",
    scope: "Fictional alternative company strategies, each in a separate shared-resource market with three fixed rival policies",
    markets, holdoutMarkets: holdout, stressMarkets,
    baseline: { genome: baselineGenome, training: evaluate(baselineGenome, markets), holdout: evaluate(baselineGenome, holdout),
      stress: stressMarkets.map(market => ({ market: market.id, ...evaluate(baselineGenome, [market]) })) }, runs };
}
