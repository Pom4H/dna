import { assumption, derive, entity, model, rule, s,
  type CheckResult, type Fact, type Infer, type Schema, type ValueResult } from "../../src/index.ts";

/** All names, amounts and snapshots are fictional. No external operation runs here. */
export const companies = Object.freeze([
  Object.freeze({ id: "buyer", name: "Вектор Фабрика" }),
  Object.freeze({ id: "supplier", name: "Контур" }),
  Object.freeze({ id: "installer", name: "Реле Сервис" }),
]);

const cents = s.number({ integer: true, min: 0 });
const signedCents = s.number({ integer: true });
const revision = s.string({ minLength: 1 });
// Domain input explicitly distinguishes no acceptance (null) from no knowledge
// (an omitted assertion). This validator does not change the kernel schema API.
const acceptedRevision: Schema<string | null> = Object.freeze({
  json: Object.freeze({ type: Object.freeze(["string", "null"]), minLength: 1 }),
  parse: (value: unknown, path?: string) => value === null ? null : revision.parse(value, path),
});
const inputShape = {
  buyerCashCents: cents,
  supplierCashCents: cents,
  stockKits: s.number({ integer: true, min: 0 }),
  installerAvailableHours: s.number({ min: 0 }),
  depositReceived: s.boolean,
  kitReserved: s.boolean,
  capacityReserved: s.boolean,
  scopeValid: s.boolean,
  installationCompleted: s.boolean,
  acceptedRevision,
  currentRevision: revision,
  catalogInstalledCents: cents,
  agreementInstalledCents: cents,
  agreementAnnualSaasCents: cents,
};

export type BusinessFacts = { readonly [K in keyof typeof inputShape]: Infer<typeof inputShape[K]> };
export type BusinessInput = Partial<BusinessFacts> & Readonly<{
  /** Additional independent reports. Unequal values conflict, never latest-wins. */
  assertions?: { readonly [K in keyof BusinessFacts]?: readonly BusinessFacts[K][] };
}>;

export const baselineInput: Readonly<BusinessFacts> = Object.freeze({
  buyerCashCents: 1_000_000, supplierCashCents: 200_000,
  stockKits: 1, installerAvailableHours: 8,
  depositReceived: false, kitReserved: false, capacityReserved: false,
  scopeValid: true, installationCompleted: false,
  acceptedRevision: null, currentRevision: "scope-1",
  catalogInstalledCents: 300_000, agreementInstalledCents: 300_000,
  agreementAnnualSaasCents: 180_000,
});

export const commercialPolicy = Object.freeze({
  currency: "EUR", depositCents: 150_000, kitCostCents: 90_000,
  installationCostCents: 60_000, installationHours: 6,
});

function objectRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${path}: expected plain object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

/** An ordinary public-kernel factory; no persistence, clocks, credentials or I/O. */
export function createBusinessModel() {
  const state = entity("network.state", { type: "fictional-company-network-snapshot", version: "1", fields: inputShape });
  const f = state.fields;
  const procurement = rule("network.decision.procurement", {
    depositReceived: f.depositReceived, supplierCashCents: f.supplierCashCents,
    stockKits: f.stockKits, kitReserved: f.kitReserved,
  }, ({ depositReceived, supplierCashCents, stockKits, kitReserved }) => {
    if (kitReserved) return { status: "pass", message: "Комплект уже зарезервирован полномочным исполнителем." };
    if (!depositReceived) return { status: "fail", message: "Аванс ещё не получен. Выставленный счёт не заменяет поступление денег." };
    if (supplierCashCents < commercialPolicy.kitCostCents) return { status: "fail", message: "Недостаточно денег поставщика для закупки комплекта EUR 900." };
    if (stockKits < 1) return { status: "fail", message: "Нет доступного комплекта в авторитетном снимке остатков." };
    return { status: "pass", message: "Аванс получен, деньги и комплект доступны в этом снимке. Закупку выполняет authority." };
  }, "Закупка: фактически полученный аванс, деньги и доступный комплект");

  const commissioning = rule("network.decision.commissioning", {
    installerAvailableHours: f.installerAvailableHours, scopeValid: f.scopeValid,
    capacityReserved: f.capacityReserved,
  }, ({ installerAvailableHours, scopeValid, capacityReserved }) => {
    if (!scopeValid) return { status: "fail", message: "Объём работ не подтверждён для текущего заказа." };
    if (capacityReserved) return { status: "pass", message: "Шесть часов монтажа уже зарезервированы authority для этого заказа." };
    return installerAvailableHours >= commercialPolicy.installationHours
      ? { status: "pass", message: "Объём работ подтверждён и доступны шесть часов. Резервирование выполняется отдельно." }
      : { status: "fail", message: "Монтаж требует шесть часов; в снимке доступно меньше." };
  }, "Монтаж: согласованный объём и шесть часов исполнителя");

  const activation = rule("network.decision.activation", {
    acceptedRevision: f.acceptedRevision, currentRevision: f.currentRevision,
    installationCompleted: f.installationCompleted,
  }, ({ acceptedRevision, currentRevision, installationCompleted }) => {
    if (!installationCompleted) return { status: "fail", message: "Монтаж ещё не завершён." };
    if (acceptedRevision === null) return { status: "fail", message: "Результат ещё не принят покупателем." };
    if (acceptedRevision !== currentRevision) return { status: "fail", message: "Приёмка относится к другой версии работ." };
    return { status: "pass", message: "Монтаж завершён, покупатель принял текущую версию. Активацию выполняет authority." };
  }, "Активация: завершённый монтаж и приёмка совпадающей версии");

  const agreedFirstYearCents = derive("network.economics.agreedFirstYearCents", cents,
    { installed: f.agreementInstalledCents, annualSaas: f.agreementAnnualSaasCents },
    ({ installed, annualSaas }) => installed + annualSaas,
    { unit: "EUR cents", description: "Полное договорное вознаграждение; не признанная выручка и не прибыль" });
  const currentOfferFirstYearCents = derive("network.economics.currentOfferFirstYearCents", cents,
    { installed: f.catalogInstalledCents, annualSaas: f.agreementAnnualSaasCents },
    ({ installed, annualSaas }) => installed + annualSaas,
    { unit: "EUR cents", description: "Сравнение новой цены оборудования при неизменной SaaS-цене примера" });
  const remainingInvoiceCents = derive("network.economics.remainingInvoiceCents", signedCents,
    { agreedFirstYearCents }, ({ agreedFirstYearCents }) => agreedFirstYearCents - commercialPolicy.depositCents,
    { unit: "EUR cents", description: "Остаток договорной цены после предусмотренного аванса; не команда выставления счёта" });
  const installedContributionCents = derive("network.economics.installedContributionCents", signedCents,
    { installed: f.agreementInstalledCents },
    ({ installed }) => installed - commercialPolicy.kitCostCents - commercialPolicy.installationCostCents,
    { unit: "EUR cents", description: "Вклад устройства и монтажа до CAC, fixed, налогов, гарантий и SaaS costs" });
  const supplierCashAfterKitCents = derive("network.economics.supplierCashAfterKitCents", signedCents,
    { cash: f.supplierCashCents, kitReserved: f.kitReserved },
    ({ cash, kitReserved }) => kitReserved ? cash : cash - commercialPolicy.kitCostCents,
    { unit: "EUR cents", description: "Условный остаток после одной закупки; отрицательный результат не разрешает платёж" });
  const buyerCashAfterDepositCents = derive("network.economics.buyerCashAfterDepositCents", signedCents,
    { cash: f.buyerCashCents, depositReceived: f.depositReceived },
    ({ cash, depositReceived }) => depositReceived ? cash : cash - commercialPolicy.depositCents,
    { unit: "EUR cents", description: "Условный остаток после одного аванса; повторный платёж здесь не выполняется" });

  const economics = { agreedFirstYearCents, remainingInvoiceCents, currentOfferFirstYearCents,
    installedContributionCents, supplierCashAfterKitCents, buyerCashAfterDepositCents };
  const business = model({ id: "fictional-company-network", version: "1",
    entities: [state], values: Object.values(economics), checks: [procurement, commissioning, activation] });

  function evaluate(input: BusinessInput) {
    const data = objectRecord(input, "business input");
    for (const key of Reflect.ownKeys(data)) {
      if (typeof key !== "string" || (key !== "assertions" && !Object.hasOwn(inputShape, key))) {
        throw new Error(`business input: unexpected property ${String(key)}`);
      }
    }
    const additions = Object.hasOwn(data, "assertions") ? objectRecord(data["assertions"], "assertions") : {};
    for (const key of Reflect.ownKeys(additions)) {
      if (typeof key !== "string" || !Object.hasOwn(inputShape, key)) throw new Error(`assertions: unexpected property ${String(key)}`);
    }
    let scenario = business.scenario("synthetic-local-company-network");
    for (const [key, definition] of Object.entries(f)) {
      // Widening only at the heterogeneous record loop; every supplied value is
      // validated by its original specific field schema before being recorded.
      const node: Fact<unknown> = definition;
      if (Object.hasOwn(data, key)) scenario = scenario.record(node,
        assumption(data[key], `Synthetic authority snapshot: ${key}; not authenticated external evidence`));
      if (Object.hasOwn(additions, key)) {
        const values = s.array(node.schema).parse(additions[key], `assertions.${key}`);
        for (const value of values) scenario = scenario.record(node,
          assumption(value, `Synthetic additional report: ${key}; explicit contradiction experiment`));
      }
    }
    const evaluated = scenario.evaluate();
    const report = evaluated.toJSON();
    const decision = (id: string): CheckResult => {
      const result = report.checks.find(check => check.id === id);
      if (!result) throw new Error(`Missing modeled check ${id}`);
      return result;
    };
    const readMoney = (id: string): ValueResult<number> => {
      const result = report.values.find(value => value.id === id);
      if (!result) throw new Error(`Missing modeled value ${id}`);
      // Every definition in economics is a number schema declared above.
      if (result.status === "known") return { ...result, value: signedCents.parse(result.value, id) };
      return result;
    };
    const ir = business.toJSON();
    const statuses = new Map([...report.values, ...report.checks].map(value => [value.id, value.status]));
    return {
      evidence: "synthetic-assumptions" as const, companies, policy: commercialPolicy,
      decisions: { procurement: decision(procurement.id), commissioning: decision(commissioning.id), activation: decision(activation.id) },
      economics: {
        agreedFirstYearCents: readMoney(agreedFirstYearCents.id), remainingInvoiceCents: readMoney(remainingInvoiceCents.id),
        currentOfferFirstYearCents: readMoney(currentOfferFirstYearCents.id), installedContributionCents: readMoney(installedContributionCents.id),
        supplierCashAfterKitCents: readMoney(supplierCashAfterKitCents.id), buyerCashAfterDepositCents: readMoney(buyerCashAfterDepositCents.id),
      },
      report,
      graph: { ...ir, nodes: ir.definitions.map(node => ({ id: node.id, kind: node.kind, status: statuses.get(node.id) ?? "unknown" })),
        edges: ir.definitions.flatMap(node => Object.values(node.dependencies).map(from => ({ from, to: node.id }))) },
      impact: { catalogInstalledCents: business.impact(f.catalogInstalledCents) },
    };
  }
  return Object.freeze({ evaluate, business, state, economics });
}

const companyNetwork = createBusinessModel();
export function evaluateBusiness(input: BusinessInput) { return companyNetwork.evaluate(input); }
export type BusinessEvaluation = ReturnType<typeof evaluateBusiness>;
