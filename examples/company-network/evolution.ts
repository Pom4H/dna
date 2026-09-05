import { assumption, derive, entity, model, rule, s, type CheckResult, type Infer } from "../../src/index.ts";

/** A bounded future-offer experiment, not a learned market or a generic optimizer. */
const offerSchema = s.object({ id: s.string({ minLength: 1 }),
  installedPriceCents: s.number({ integer: true, min: 0, max: 100_000_000 }),
  installationHours: s.number({ integer: true, min: 0, max: 10_000 }) });
const contextSchema = s.object({
  buyerMaximumPriceCents: s.number({ integer: true, min: 0, max: 100_000_000 }),
  installerAvailableHours: s.number({ integer: true, min: 0, max: 10_000 }),
  supplierOpeningCashCents: s.number({ integer: true, min: 0, max: 1_000_000_000_000 }),
  depositPercent: s.number({ integer: true, min: 0, max: 100 }),
});
export type OfferCandidate = Infer<typeof offerSchema>;
export type SearchContext = Infer<typeof contextSchema>;
export const searchContext: SearchContext = Object.freeze({ buyerMaximumPriceCents: 310_000,
  installerAvailableHours: 8, supplierOpeningCashCents: 200_000, depositPercent: 50 });
const policy = Object.freeze({ kitCostCents: 90_000, hourlyCostCents: 5_000, travelCostCents: 10_000, qualityMinimumHours: 6 });
const integer = s.number({ integer: true });
const cashEvent = s.object({ step: s.string({ minLength: 1 }), amountCents: integer, balanceCents: integer });

function futureOfferModel() {
  const candidate = entity("future-offer.candidate", { type: "synthetic-unaccepted-offer", version: "1",
    fields: { installedPriceCents: integer, installationHours: integer } });
  const context = entity("future-offer.context", { type: "synthetic-three-party-planning-context", version: "1",
    fields: { buyerMaximumPriceCents: integer, installerAvailableHours: integer,
      supplierOpeningCashCents: integer, depositPercent: integer } });
  const installationCostCents = derive("future-offer.installation-cost", integer,
    { hours: candidate.fields.installationHours }, ({ hours }) => hours * policy.hourlyCostCents + policy.travelCostCents);
  const unitMarginCents = derive("future-offer.unit-margin", integer,
    { price: candidate.fields.installedPriceCents, installationCostCents },
    ({ price, installationCostCents }) => price - policy.kitCostCents - installationCostCents);
  const buyerRemainingBenefitCents = derive("future-offer.buyer-remaining-benefit", integer,
    { price: candidate.fields.installedPriceCents, cap: context.fields.buyerMaximumPriceCents },
    ({ price, cap }) => cap - price);
  const depositCents = derive("future-offer.deposit", integer,
    { price: candidate.fields.installedPriceCents, percent: context.fields.depositPercent },
    // Declared rounding policy: fractional cents are rounded down. Input bounds
    // ensure the intermediate multiplication stays a safe integer.
    ({ price, percent }) => Math.floor(price * percent / 100));
  const cashSchedule = derive("future-offer.cash-schedule", s.array(cashEvent),
    { opening: context.fields.supplierOpeningCashCents, price: candidate.fields.installedPriceCents,
      depositCents, installationCostCents }, ({ opening, price, depositCents, installationCostCents }) => {
      let balance = opening;
      return [
        { step: "opening", amountCents: 0, balanceCents: balance },
        { step: "customer-deposit", amountCents: depositCents, balanceCents: balance += depositCents },
        { step: "kit-paid", amountCents: -policy.kitCostCents, balanceCents: balance -= policy.kitCostCents },
        { step: "installation-and-travel-paid", amountCents: -installationCostCents, balanceCents: balance -= installationCostCents },
        { step: "customer-final-payment", amountCents: price - depositCents, balanceCents: balance += price - depositCents },
      ];
    });
  const minimumSupplierCashCents = derive("future-offer.cash-minimum", integer,
    { cashSchedule }, ({ cashSchedule }) => Math.min(...cashSchedule.map(event => event.balanceCents)));
  const quality = rule("future-offer.check.quality", { hours: candidate.fields.installationHours },
    ({ hours }) => ({ status: hours >= policy.qualityMinimumHours ? "pass" : "fail",
      message: "Синтетический минимальный объём: не менее шести часов. Сокращение ниже порога не считается улучшением." }), "Не сокращать обязательный объём качества");
  const buyer = rule("future-offer.check.buyer", { buyerRemainingBenefitCents },
    ({ buyerRemainingBenefitCents }) => ({ status: buyerRemainingBenefitCents >= 0 ? "pass" : "fail",
      message: "Цена должна быть не выше условного предела покупателя. Этот предел не измеряет реальный спрос." }), "Условная приемлемость цены покупателем");
  const capacity = rule("future-offer.check.capacity", {
    required: candidate.fields.installationHours, available: context.fields.installerAvailableHours },
    ({ required, available }) => ({ status: available >= required ? "pass" : "fail",
      message: "Требуемые часы должны помещаться в ресурс монтажника; проверка не резервирует часы." }), "Достаточность ресурса монтажника");
  const cash = rule("future-offer.check.cash", { minimumSupplierCashCents },
    ({ minimumSupplierCashCents }) => ({ status: minimumSupplierCashCents >= 0 ? "pass" : "fail",
      message: "Деньги не должны уходить в минус до окончательного платежа покупателя." }), "Исполнимость заданного денежного порядка");
  const contribution = rule("future-offer.check.contribution", { unitMarginCents },
    ({ unitMarginCents }) => ({ status: unitMarginCents > 0 ? "pass" : "fail",
      message: "Вклад установленного комплекта должен быть положительным до общих и исключённых затрат." }), "Положительный прямой вклад");
  const business = model({ id: "future-offer-search", version: "1", entities: [candidate, context],
    values: [unitMarginCents, buyerRemainingBenefitCents, depositCents, cashSchedule, minimumSupplierCashCents, installationCostCents],
    checks: [quality, buyer, capacity, cash, contribution] });
  return { candidate, context, business, values: { unitMarginCents, buyerRemainingBenefitCents, depositCents,
    cashSchedule, minimumSupplierCashCents, installationCostCents }, checks: { quality, buyer, capacity, cash, contribution } };
}

const futureModel = futureOfferModel();

export function evaluateCandidate(input: OfferCandidate, contextInput: SearchContext = searchContext) {
  const offer = offerSchema.parse(input);
  const context = contextSchema.parse(contextInput);
  const { candidate: c, context: x, business, values, checks } = futureModel;
  const a = (value: number) => assumption(value, "Synthetic finite future-offer scenario; no real demand or quality evidence");
  const scenario = business.scenario(offer.id)
    .set(c.fields.installedPriceCents, a(offer.installedPriceCents))
    .set(c.fields.installationHours, a(offer.installationHours))
    .set(x.fields.buyerMaximumPriceCents, a(context.buyerMaximumPriceCents))
    .set(x.fields.installerAvailableHours, a(context.installerAvailableHours))
    .set(x.fields.supplierOpeningCashCents, a(context.supplierOpeningCashCents))
    .set(x.fields.depositPercent, a(context.depositPercent));
  const report = scenario.evaluate().toJSON();
  const check = (id: string): CheckResult => {
    const result = report.checks.find(value => value.id === id);
    if (!result) throw new Error(`Missing future-offer decision ${id}`);
    return result;
  };
  const metric = (id: string): number => {
    const result = report.values.find(value => value.id === id);
    if (result?.status !== "known") throw new Error(`Future-offer metric unresolved: ${id}`);
    return integer.parse(result.value, id);
  };
  const schedule = scenario.read(values.cashSchedule);
  if (schedule.status !== "known") throw new Error("Future-offer cash schedule unresolved");
  const decisions = { quality: check(checks.quality.id), buyer: check(checks.buyer.id), capacity: check(checks.capacity.id),
    cash: check(checks.cash.id), contribution: check(checks.contribution.id) };
  return { id: offer.id, label: `${offer.installedPriceCents / 100} EUR · ${offer.installationHours} ч`,
    subjectIds: ["buyer", "supplier", "installer"], scope: "future-new-offers-only" as const,
    offer, context, status: report.ok ? "feasible" as const : "rejected" as const, feasible: report.ok,
    metrics: { unitMarginCents: metric(values.unitMarginCents.id), buyerRemainingBenefitCents: metric(values.buyerRemainingBenefitCents.id),
      depositCents: metric(values.depositCents.id), minimumSupplierCashCents: metric(values.minimumSupplierCashCents.id),
      installationCostCents: metric(values.installationCostCents.id) },
    decisions, reasons: Object.values(decisions).filter(value => value.status !== "pass").map(value => value.message),
    cashSchedule: schedule.value, modelId: business.id, modelVersion: business.version };
}

export function evaluateCandidates() {
  const offers: OfferCandidate[] = [280_000, 300_000, 320_000].flatMap(installedPriceCents => [6, 8]
    .map(installationHours => ({ id: `future-${installedPriceCents / 100}-h${installationHours}`, installedPriceCents, installationHours })));
  offers.push({ id: "future-3000-h5", installedPriceCents: 300_000, installationHours: 5 });
  const candidates = offers.map(offer => evaluateCandidate(offer));
  const ranked = candidates.filter(candidate => candidate.feasible).sort((a, b) =>
    b.metrics.unitMarginCents - a.metrics.unitMarginCents ||
    b.metrics.buyerRemainingBenefitCents - a.metrics.buyerRemainingBenefitCents || a.id.localeCompare(b.id));
  const baseline = candidates.find(candidate => candidate.id === "future-3000-h8");
  if (!baseline) throw new Error("Missing future-offer planning baseline");
  return { format: "dna.future-offer-search/v0.1" as const, evidence: "synthetic-assumptions" as const,
    description: "bounded synthetic search; no global optimum or real demand proof",
    scope: "Future unaccepted offers only. Existing accepted orders, money and operations are not changed.",
    assumptions: ["Порог цены EUR 3 100 задан вручную; наблюдений спроса нет.",
      "Порог шесть часов — условное ограничение задачи, а не доказанная модель качества.",
      "Порядок оплаты предполагает получение аванса до затрат и финальный платёж после установки.",
      "Вклад исключает SaaS, CAC, fixed, налоги, гарантии и R&D.",
      "Плановый baseline 8 часов относится к новым предложениям; принятая цена монтажа текущего заказа не меняется."],
    objective: ["All modeled constraints pass", "Maximum installed contribution", "Maximum remaining buyer value at equal contribution"],
    context: searchContext, policy, baseline, candidates, feasibleCount: ranked.length,
    bestId: ranked[0]?.id ?? null, rankedIds: ranked.map(candidate => candidate.id) };
}

export type CandidateEvaluation = ReturnType<typeof evaluateCandidate>;
export type EvolutionEvaluation = ReturnType<typeof evaluateCandidates>;
