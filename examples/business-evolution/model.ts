import { assumption, derive, entity, model, rule, s, type Infer } from "../../src/index.ts";

// This entire market is fictional. These functions are hypotheses about behavior,
// not learned demand, authenticated evidence, or a financial forecasting service.
const money = s.number({ integer: true, min: 0, max: 100_000_000 });
export const genomeSchema = s.object({
  channel: s.enum("direct", "partner"), payment: s.enum("purchase", "service"),
  entryPriceCents: money, monthlyCents: money,
  depositPercent: s.number({ integer: true, min: 0, max: 100 }),
  installationHours: s.number({ integer: true, min: 1, max: 16 }),
  component: s.enum("standard", "rugged"), support: s.enum("lean", "staffed"),
  cashReserveMonths: s.number({ integer: true, min: 0, max: 12 }),
});
export type Genome = Infer<typeof genomeSchema>;
export const baselineGenome: Genome = genomeSchema.parse({ channel: "direct", payment: "purchase",
  entryPriceCents: 300_000, monthlyCents: 15_000, depositPercent: 50,
  installationHours: 8, component: "standard", support: "staffed", cashReserveMonths: 0 });

export const marketSchema = s.object({
  id: s.string({ minLength: 1 }), seed: s.number({ integer: true, min: 0, max: 0xffff_ffff }),
  openingCashCents: money, fixedMonthlyCents: money,
  buyersPerMonth: s.number({ integer: true, min: 0, max: 200 }),
  kitsPerMonth: s.number({ integer: true, min: 0, max: 200 }),
  installerHoursPerMonth: s.number({ integer: true, min: 0, max: 3_200 }),
  buyerLiquidity: s.number({ min: 0.1, max: 3 }),
  benefitMultiplier: s.number({ min: 0.1, max: 3 }),
  kitCostMultiplier: s.number({ min: 0.1, max: 3 }),
  paymentDelayMonths: s.number({ integer: true, min: 1, max: 6 }),
  rivalPriceMultiplier: s.number({ min: 0.5, max: 2 }),
});
export type Market = Infer<typeof marketSchema>;
const baseMarket: Market = marketSchema.parse({ id: "synthetic", seed: 1, openingCashCents: 4_000_000,
  fixedMonthlyCents: 240_000, buyersPerMonth: 28, kitsPerMonth: 12, installerHoursPerMonth: 72,
  buyerLiquidity: 1, benefitMultiplier: 1, kitCostMultiplier: 1, paymentDelayMonths: 1, rivalPriceMultiplier: 1 });
const initialTrainingMarkets: readonly Market[] = Object.freeze([101, 211, 307, 401, 503, 601]
  .map((seed, i) => marketSchema.parse({ ...baseMarket, id: `train-${seed}`, seed,
    buyerLiquidity: i % 2 === 0 ? 1 : 0.7, paymentDelayMonths: i % 3 === 0 ? 3 : 1,
    kitCostMultiplier: i >= 4 ? 1.2 : 1 })));
// v1 holdout is now development evidence, not an unseen evaluation set.
export const diagnosticMarkets: readonly Market[] = Object.freeze([701, 809, 907, 1009, 1103, 1201]
  .map((seed, i) => marketSchema.parse({ ...initialTrainingMarkets[i]!, id: `diagnostic-${seed}`, seed })));
export const trainingMarkets: readonly Market[] = Object.freeze([...initialTrainingMarkets,
  ...diagnosticMarkets.filter(market => market.seed === 1009 || market.seed === 1103)]);
export const holdoutMarkets: readonly Market[] = Object.freeze([2003, 2111, 2203, 2309, 2411, 2503]
  .map((seed, i) => marketSchema.parse({ ...initialTrainingMarkets[i]!, id: `final-holdout-${seed}`, seed })));
export const stressMarkets: readonly Market[] = Object.freeze([
  marketSchema.parse({ ...baseMarket, id: "stress-price-war", seed: 1409, rivalPriceMultiplier: 0.65 }),
  marketSchema.parse({ ...baseMarket, id: "stress-supply", seed: 1511, kitsPerMonth: 10, installerHoursPerMonth: 66, kitCostMultiplier: 1.5 }),
  marketSchema.parse({ ...baseMarket, id: "stress-demand", seed: 1601, buyersPerMonth: 14, benefitMultiplier: 0.7 }),
  marketSchema.parse({ ...baseMarket, id: "stress-credit", seed: 1709, openingCashCents: 2_000_000, buyerLiquidity: 0.5, paymentDelayMonths: 6 }),
]);

// Counter-based draws keep a customer's environment the same across candidates;
// a candidate creating more contracts must not shift another customer's RNG stream.
export function draw(seed: number, ...coordinates: number[]): number {
  let value = seed >>> 0;
  for (const coordinate of coordinates) {
    value = Math.imul(value ^ coordinate, 0x45d9f3b);
    value = (value ^ (value >>> 16)) >>> 0;
  }
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

export function acceptContract(buyerId: string, month: number, input: Genome) {
  const terms = genomeSchema.parse(input);
  const entryCents = terms.payment === "purchase" ? terms.entryPriceCents : Math.round(terms.entryPriceCents / 5);
  return Object.freeze({ buyerId, month, terms, entryCents,
    depositCents: Math.floor(entryCents * terms.depositPercent / 100), durationMonths: 12 });
}
export type AcceptedContract = ReturnType<typeof acceptContract>;
type Cohort = { contract: AcceptedContract; buyerNumber: number; active: boolean; finalPaid: boolean; dueMonth: number };
export type MonthResult = { month: number; cashCents: number; activeContracts: number; orders: number };
export type CompanyResult = {
  id: string; orders: number; subscriptionMonths: number; incidents: number; churned: number;
  fundingRejected: number; capacityRejected: number; minimumCashCents: number; finalCashCents: number;
  cashMovementsCents: number; netCashCents: number; openObligations: number; resourceOverdraw: number;
  contracts: AcceptedContract[]; months: MonthResult[];
};
type Company = { genome: Genome; cash: number; minimumCash: number; cashMovements: number;
  cohorts: Cohort[]; result: CompanyResult; reputationPenalty: number };
export type SimulationOptions = { changeAtMonth?: number; next?: Genome; trace?: boolean };

function makeCompany(id: string, genome: Genome, cash: number): Company {
  return { genome, cash, minimumCash: cash, cashMovements: 0, cohorts: [], reputationPenalty: 0,
    result: { id, orders: 0, subscriptionMonths: 0, incidents: 0, churned: 0,
      fundingRejected: 0, capacityRejected: 0, minimumCashCents: cash, finalCashCents: cash,
      cashMovementsCents: 0, netCashCents: 0, openObligations: 0, resourceOverdraw: 0, contracts: [], months: [] } };
}
function move(company: Company, amount: number) {
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(company.cash + amount)) throw new Error("Unsafe money arithmetic");
  company.cash += amount;
  company.cashMovements += amount;
  company.minimumCash = Math.min(company.minimumCash, company.cash);
}
function collect(company: Company, contract: AcceptedContract, amount: number) {
  move(company, amount);
  if (contract.terms.channel === "partner") move(company, -Math.round(amount * 0.12));
}
function service(company: Company, cohort: Cohort, market: Market, month: number) {
  const { contract } = cohort;
  const age = month - contract.month;
  if (age >= contract.durationMonths) { cohort.active = false; return; }
  if (!cohort.active) return;
  const terms = contract.terms;
  const faultProbability = (terms.component === "rugged" ? 0.025 : 0.06) *
    (terms.installationHours >= 8 ? 0.65 : terms.installationHours >= 6 ? 1 : 1.8);
  const incident = draw(market.seed, cohort.buyerNumber, age, 77) < faultProbability;
  // Service cost precedes this month's receipt, including the final service month.
  move(company, -2_000);
  if (incident) {
    company.result.incidents++;
    move(company, -(terms.support === "staffed" ? 14_000 : 40_000));
    move(company, -terms.monthlyCents); // one month's contractual service credit
    company.reputationPenalty += terms.support === "staffed" ? 6_000 : 16_000;
  }
  collect(company, contract, terms.monthlyCents);
  company.result.subscriptionMonths++;
  const churnProbability = terms.support === "staffed" ? (incident ? 0.04 : 0.004) : (incident ? 0.12 : 0.008);
  // Fictional cancellable contract: customer can leave after three paid months.
  // No assumed salvage value or future receipts from cancelled devices.
  if (age >= 2 && draw(market.seed, cohort.buyerNumber, age, 99) < churnProbability) {
    cohort.active = false;
    company.result.churned++;
  }
}

/** 12 months of acquisitions + 12 months of runoff; no perpetual/terminal value. */
export function simulateMarket(input: Genome, marketInput: Market, options: SimulationOptions = {}) {
  const genome = genomeSchema.parse(input);
  const market = marketSchema.parse(marketInput);
  if ((options.next === undefined) !== (options.changeAtMonth === undefined)) throw new Error("A revision needs both month and genome");
  if (options.changeAtMonth !== undefined && (!Number.isInteger(options.changeAtMonth) || options.changeAtMonth < 0 || options.changeAtMonth > 11)) {
    throw new Error("Revision must precede the last acquisition month");
  }
  const next = options.next === undefined ? undefined : genomeSchema.parse(options.next);
  const rival = (value: Genome): Genome => genomeSchema.parse({ ...value,
    entryPriceCents: Math.round(value.entryPriceCents * market.rivalPriceMultiplier),
    monthlyCents: Math.round(value.monthlyCents * market.rivalPriceMultiplier) });
  const companies = [makeCompany("candidate", genome, market.openingCashCents),
    makeCompany("fictional-incumbent", rival({ ...baselineGenome, installationHours: 6 }), market.openingCashCents),
    makeCompany("fictional-service-rival", rival({ ...baselineGenome, channel: "partner", payment: "service",
      monthlyCents: 28_000, installationHours: 6, support: "lean" }), market.openingCashCents),
    makeCompany("fictional-premium-rival", rival({ ...baselineGenome, entryPriceCents: 360_000,
      monthlyCents: 22_000, component: "rugged" }), market.openingCashCents)];
  let resourceOverdraw = 0;
  for (let month = 0; month < 24; month++) {
    if (month === options.changeAtMonth && next) companies[0]!.genome = next;
    for (const company of companies) {
      company.reputationPenalty = Math.round(company.reputationPenalty * 0.8);
      const staffed = company.genome.support === "staffed" || company.cohorts.some(cohort => cohort.active && cohort.contract.terms.support === "staffed");
      move(company, -market.fixedMonthlyCents - (staffed ? 80_000 : 0));
      for (const cohort of company.cohorts) {
        if (!cohort.finalPaid && month >= cohort.dueMonth) {
          collect(company, cohort.contract, cohort.contract.entryCents - cohort.contract.depositCents);
          cohort.finalPaid = true;
        }
        service(company, cohort, market, month);
      }
    }
    let kits = market.kitsPerMonth;
    let hours = market.installerHoursPerMonth;
    if (month < 12) for (let buyer = 0; buyer < market.buyersPerMonth; buyer++) {
      const number = month * market.buyersPerMonth + buyer;
      const benefit = (600_000 + draw(market.seed, number, 1) * 400_000) * market.benefitMultiplier;
      const entryBudget = (90_000 + draw(market.seed, number, 2) * 420_000) * market.buyerLiquidity;
      const availableDeposit = (40_000 + draw(market.seed, number, 3) * 220_000) * market.buyerLiquidity;
      const bids = companies.map((company, index) => {
        const terms = company.genome;
        const contract = acceptContract(`fictional-buyer-${number}`, month, terms);
        const reach = draw(market.seed, number, index, 4) < (terms.channel === "partner" ? 0.8 : 0.58);
        const perceivedReliability = terms.component === "rugged" ? 0.97 : 0.9;
        const fit = (draw(market.seed, number, index, 5) - 0.5) * 220_000;
        const utility = benefit * perceivedReliability + fit - contract.entryCents - terms.monthlyCents * 12
          - contract.depositCents * 0.15 - company.reputationPenalty - 160_000;
        return { company, index, contract, utility, interested: reach && contract.entryCents <= entryBudget
          && contract.depositCents <= availableDeposit && utility > 0 && company.minimumCash >= 0 };
      }).filter(bid => bid.interested).sort((a, b) => b.utility - a.utility || a.index - b.index);
      for (const { company, contract } of bids) {
        const terms = contract.terms;
        if (kits < 1 || hours < terms.installationHours) { company.result.capacityRejected++; continue; }
        const kitCost = Math.round((terms.component === "rugged" ? 120_000 : 90_000) * market.kitCostMultiplier);
        const installationCost = terms.installationHours * 5_000 + 10_000;
        const acquisitionCost = terms.channel === "direct" ? 40_000 : 12_000;
        const commission = terms.channel === "partner" ? Math.round(contract.depositCents * 0.12) : 0;
        // Future subscriptions and delayed final payments cannot finance today's delivery.
        const active = company.cohorts.filter(cohort => cohort.active);
        const staffed = terms.support === "staffed" || active.some(cohort => cohort.contract.terms.support === "staffed");
        const nextMonthCommitment = market.fixedMonthlyCents + (staffed ? 80_000 : 0) + (active.length + 1) * 2_000;
        const reserve = terms.cashReserveMonths * nextMonthCommitment;
        if (company.cash + contract.depositCents - commission - reserve < kitCost + installationCost + acquisitionCost) {
          company.result.fundingRejected++; continue;
        }
        collect(company, contract, contract.depositCents);
        move(company, -kitCost);
        move(company, -installationCost);
        move(company, -acquisitionCost);
        kits--;
        hours -= terms.installationHours;
        resourceOverdraw += Math.max(0, -kits) + Math.max(0, -hours);
        const cohort: Cohort = { contract, buyerNumber: number, active: true,
          finalPaid: contract.depositCents === contract.entryCents, dueMonth: month + market.paymentDelayMonths };
        company.cohorts.push(cohort);
        company.result.orders++;
        service(company, cohort, market, month);
        break;
      }
    }
    if (options.trace) for (const company of companies) company.result.months.push({ month, cashCents: company.cash,
      activeContracts: company.cohorts.filter(cohort => cohort.active).length, orders: company.result.orders });
  }
  for (const company of companies) {
    Object.assign(company.result, { minimumCashCents: company.minimumCash, finalCashCents: company.cash,
      cashMovementsCents: company.cashMovements, netCashCents: company.cash - market.openingCashCents,
      openObligations: company.cohorts.filter(cohort => cohort.active || !cohort.finalPaid).length,
      resourceOverdraw, contracts: options.trace ? company.cohorts.map(cohort => cohort.contract) : [] });
  }
  return { marketId: market.id, focal: companies[0]!.result, companies: companies.map(company => company.result), resourceOverdraw };
}

// Ordinary factory over the public DNA kernel. Business-specific vocabulary stays here.
function createAssessment() {
  const integer = s.number({ integer: true });
  const state = entity("evolution.metrics", { type: "synthetic-business-outcomes", version: "1", fields: {
    meanNetCashCents: integer, worstNetCashCents: integer, minimumCashCents: integer,
    installationHours: integer, openObligations: integer, resourceOverdraw: integer,
  } });
  const f = state.fields;
  const score = derive("evolution.score", integer, { mean: f.meanNetCashCents, worst: f.worstNetCashCents },
    ({ mean, worst }) => Math.round((mean + worst) / 2));
  const checks = [
    rule("evolution.quality", { hours: f.installationHours }, ({ hours }) => hours >= 6),
    rule("evolution.solvency", { cash: f.minimumCashCents }, ({ cash }) => cash >= 0),
    rule("evolution.obligations", { count: f.openObligations }, ({ count }) => count === 0),
    rule("evolution.resources", { overdraw: f.resourceOverdraw }, ({ overdraw }) => overdraw === 0),
  ];
  return { state, score, business: model({ id: "business-evolution-assessment", version: "1", entities: [state], values: [score], checks }) };
}
const assessment = createAssessment();
export function assess(genomeInput: Genome, outcomes: readonly CompanyResult[]) {
  const genome = genomeSchema.parse(genomeInput);
  const { state, score, business } = assessment;
  const f = state.fields;
  const a = (value: number) => assumption(value, "Synthetic market model; not empirical business validation");
  const scenario = business.scenario("candidate").batch(draft => {
    draft.set(f.installationHours, a(genome.installationHours));
    if (outcomes.length) {
      draft.set(f.meanNetCashCents, a(Math.round(outcomes.reduce((sum, value) => sum + value.netCashCents, 0) / outcomes.length)));
      draft.set(f.worstNetCashCents, a(Math.min(...outcomes.map(value => value.netCashCents))));
      draft.set(f.minimumCashCents, a(Math.min(...outcomes.map(value => value.minimumCashCents))));
      draft.set(f.openObligations, a(Math.max(...outcomes.map(value => value.openObligations))));
      draft.set(f.resourceOverdraw, a(Math.max(...outcomes.map(value => value.resourceOverdraw))));
    }
  });
  const result = scenario.evaluate().toJSON();
  const scoreResult = scenario.read(score);
  return { feasible: result.ok, scoreCents: scoreResult.status === "known" ? scoreResult.value : null,
    decisions: result.checks,
    meanNetCashCents: outcomes.length ? Math.round(outcomes.reduce((sum, value) => sum + value.netCashCents, 0) / outcomes.length) : null,
    worstNetCashCents: outcomes.length ? Math.min(...outcomes.map(value => value.netCashCents)) : null,
    minimumCashCents: outcomes.length ? Math.min(...outcomes.map(value => value.minimumCashCents)) : null,
    meanOrders: outcomes.length ? outcomes.reduce((sum, value) => sum + value.orders, 0) / outcomes.length : null };
}
export type Assessment = ReturnType<typeof assess>;
