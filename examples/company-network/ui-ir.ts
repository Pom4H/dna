import { s, type Infer, type Schema } from "../../src/index.ts";
import type { Session } from "./authority.ts";
import type { BusinessEvaluation } from "./model.ts";

const text = s.string();
const id = s.string({ minLength: 1 });
const cents = s.number({ integer: true, min: 0 });
const decisionStatus = s.enum("pass", "fail", "unknown", "conflict", "error");
const valueStatus = s.enum("known", "unknown", "conflict", "error");
const colors = s.enum("mint", "amber", "blue", "violet", "rose", "slate");

export interface UiMetric { readonly id: string; readonly label: string; readonly value: string; readonly unit?: string }
function record(value: unknown, allowed: readonly string[], path: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${path}: expected plain object`);
  const input = value as Readonly<Record<string, unknown>>;
  for (const key of Reflect.ownKeys(input)) if (typeof key !== "string" || !allowed.includes(key)) throw new Error(`${path}: unexpected property ${String(key)}`);
  return input;
}
const metricSchema: Schema<UiMetric> = {
  json: { type: "object", required: ["id", "label", "value"], additionalProperties: false,
    properties: { id: id.json, label: text.json, value: text.json, unit: text.json } },
  parse(value, path = "metric") {
    const input = record(value, ["id", "label", "value", "unit"], path);
    return Object.freeze({ id: id.parse(input["id"], `${path}.id`), label: text.parse(input["label"], `${path}.label`),
      value: text.parse(input["value"], `${path}.value`),
      ...(Object.hasOwn(input, "unit") ? { unit: text.parse(input["unit"], `${path}.unit`) } : {}) });
  },
};
const subjectSchema = s.object({ id, label: text, role: text, color: colors, metrics: s.array(metricSchema), state: text });
const relationSchema = s.object({ id, from: id, to: id, label: text, state: s.enum("pending", "active", "done", "blocked") });
const actionSchema = s.object({ id, label: text, actor: id, enabled: s.boolean, reason: text });
const decisionSchema = s.object({ id, label: text, status: decisionStatus, message: text, subjectId: id });
const eventSchema = s.object({ id, at: id, actor: id, label: text, status: text, detail: text });
const contractSchema = s.object({ id, revision: id, totalCents: cents, remainingCents: cents, currency: s.string({ minLength: 3, maxLength: 3 }) });
const knowledgeSchema = s.object({ label: text, assumptions: s.array(text),
  facts: s.array(s.object({ id, label: text, status: valueStatus, value: text, provenance: s.array(text), causes: s.array(text) })) });
const coreSchema = s.object({ schema: s.enum("dna.ui"), version: s.enum("0.1"), title: text, subtitle: text,
  subjects: s.array(subjectSchema), relations: s.array(relationSchema), actions: s.array(actionSchema),
  decisions: s.array(decisionSchema), events: s.array(eventSchema), contract: contractSchema });
export type UiIR = Infer<typeof coreSchema> & Readonly<{ knowledge?: Infer<typeof knowledgeSchema> }>;

/** Plain versioned presentation data. No shell, theme, code, URLs or executable commands. */
export function validateUiIR(value: unknown): UiIR {
  const input = record(value, ["schema", "version", "title", "subtitle", "subjects", "relations", "actions", "decisions", "events", "contract", "knowledge"], "UI IR");
  const { knowledge: _knowledge, ...core } = input;
  const parsed = coreSchema.parse(core, "UI IR");
  for (const [label, entries] of Object.entries({ subjects: parsed.subjects, relations: parsed.relations,
    actions: parsed.actions, decisions: parsed.decisions, events: parsed.events })) {
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error(`UI IR: duplicate ${label} identity`);
  }
  const subjects = new Set(parsed.subjects.map(subject => subject.id));
  for (const subject of parsed.subjects) if (new Set(subject.metrics.map(metric => metric.id)).size !== subject.metrics.length) throw new Error(`UI IR: duplicate metric on ${subject.id}`);
  for (const relation of parsed.relations) if (!subjects.has(relation.from) || !subjects.has(relation.to)) throw new Error(`UI IR: dangling relation ${relation.id}`);
  for (const action of parsed.actions) if (!subjects.has(action.actor)) throw new Error(`UI IR: dangling action ${action.id}`);
  for (const decision of parsed.decisions) if (!subjects.has(decision.subjectId)) throw new Error(`UI IR: dangling decision ${decision.id}`);
  // Event actors identify the emitting source; runtime/system sources need not
  // be displayed as business subjects. All reference-bearing fields above do.
  const knowledge = Object.hasOwn(input, "knowledge") ? knowledgeSchema.parse(input["knowledge"], "UI IR.knowledge") : undefined;
  if (knowledge && new Set(knowledge.facts.map(fact => fact.id)).size !== knowledge.facts.length) throw new Error("UI IR: duplicate knowledge identity");
  return Object.freeze({ ...parsed, ...(knowledge ? { knowledge } : {}) });
}

export interface RuntimeUiEvent {
  readonly id: string; readonly at: string; readonly company: string; readonly type: string;
  readonly label: string; readonly detail: string; readonly attempt?: number;
}
export interface UiWorkflow { readonly company: string; readonly runId: string; readonly stage: string; readonly status: string }

const eur = (value: number) => (value / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Business-specific projection. The generic IR validator has no company vocabulary.
 * enabled is display guidance only: the server must recheck every requested action.
 */
export function projectCompanyUI(session: Session, evaluation: BusinessEvaluation,
  runtimeEvents: readonly RuntimeUiEvent[] = [], workflows: readonly UiWorkflow[] = []): UiIR {
  const decision = evaluation.decisions;
  const fact = (name: string) => evaluation.report.values.find(value => value.id === `network.state.${name}`);
  const known = (name: string, expected: unknown) => {
    const result = fact(name);
    return result?.status === "known" && result.value === expected;
  };
  const metricValue = (name: string, render: (value: unknown) => string) => {
    const value = fact(name);
    return value?.status === "known" ? render(value.value) : value?.status === "conflict" ? "Конфликт" : value?.status === "error" ? "Ошибка" : "Неизвестно";
  };
  const moneyValue = (name: string) => metricValue(name, value => eur(cents.parse(value, name)));
  const workflowState = (company: string, fallback: string) => {
    const workflow = workflows.find(entry => entry.company === company);
    return workflow ? `${workflow.stage} · ${workflow.status}` : fallback;
  };
  const supplierRelation = session.kitReserved ? "done" : decision.procurement.status === "pass" ? "active" : decision.procurement.status === "fail" ? "pending" : "blocked";
  const installRelation = session.installationCompleted ? "done" : session.capacityReserved ? "active" : decision.commissioning.status === "pass" ? "pending" : "blocked";
  const activationRelation = session.subscriptionActive ? "done" : decision.activation.status === "pass" ? "active" : "pending";
  const canPay = !session.depositReceived && known("depositReceived", false) &&
    known("buyerCashCents", session.buyerCashCents) && session.buyerCashCents >= session.terms.depositCents;
  const canAccept = session.installationCompleted && session.acceptedRevision === null &&
    known("installationCompleted", true) && known("acceptedRevision", null) && known("currentRevision", session.scopeRevision);
  const canRepair = !session.capacityReserved && session.installerAvailableHours < session.terms.installationHours &&
    known("installerAvailableHours", session.installerAvailableHours);
  const result: UiIR = {
    schema: "dna.ui", version: "0.1", title: "Компании действуют по одной модели",
    subtitle: "Вымышленная сеть · локальные workflow · решения DNA и подтверждения authority",
    subjects: [
      { id: "buyer", label: "Вектор Фабрика", role: "Покупатель", color: "mint",
        state: workflowState("buyer", session.acceptedRevision ? "Результат принят" : "Ожидает поставку"),
        metrics: [{ id: "cash", label: "Деньги", value: moneyValue("buyerCashCents"), unit: "EUR" },
          { id: "deposit", label: "Аванс", value: metricValue("depositReceived", value => value === true ? "Получен поставщиком" : "Не отправлен") }] },
      { id: "supplier", label: "Контур", role: "Поставщик устройства и ПО", color: "blue",
        state: workflowState("supplier", session.subscriptionActive ? "Сервис активен" : "Готовит исполнение"),
        metrics: [{ id: "cash", label: "Деньги", value: moneyValue("supplierCashCents"), unit: "EUR" },
          { id: "stock", label: "Доступные комплекты", value: metricValue("stockKits", String), unit: "шт." }] },
      { id: "installer", label: "Реле Сервис", role: "Монтажный партнёр", color: "amber",
        state: workflowState("installer", session.installationCompleted ? "Монтаж завершён" : "Проверяет ресурсы"),
        metrics: [{ id: "capacity", label: "Свободное время", value: metricValue("installerAvailableHours", String), unit: "ч" },
          { id: "cash", label: "Получено за монтаж", value: eur(session.installerCashCents), unit: "EUR" }] },
    ],
    relations: [
      { id: "deposit", from: "buyer", to: "supplier", label: "Аванс 1 500 EUR", state: session.depositReceived ? "done" : "pending" },
      { id: "kit", from: "supplier", to: "installer", label: "Комплект и заказ на монтаж", state: supplierRelation },
      { id: "installation", from: "installer", to: "buyer", label: "Установка и передача результата", state: installRelation },
      { id: "subscription", from: "supplier", to: "buyer", label: "Активация ПО после приёмки", state: activationRelation },
    ],
    actions: [
      { id: "pay", label: "Оплатить аванс", actor: "buyer", enabled: canPay,
        reason: canPay ? "Запросить у authority единственный перевод аванса." : session.depositReceived ? "Аванс уже получен." : "Нет достаточных известных оснований для платежа." },
      { id: "accept", label: "Принять результат", actor: "buyer", enabled: canAccept,
        reason: canAccept ? "Подтвердить приёмку текущей версии работ." : "Нужны завершённый монтаж и непринятая текущая версия." },
      { id: "repair-capacity", label: "Добавить ресурс монтажа", actor: "installer", enabled: canRepair,
        reason: canRepair ? "Вымышленный сценарий: подтвердить восемь доступных часов." : "Изменение ресурса сейчас не требуется или оснований недостаточно." },
      { id: "feedback", label: "Передать отзыв", actor: "buyer", enabled: session.subscriptionActive,
        reason: session.subscriptionActive ? "Отзыв запускает отдельное рассмотрение предложения; действующий договор не изменяется." : "Отзыв доступен после активации сервиса." },
    ],
    decisions: [
      { id: "procurement", label: "Готовность закупки", status: decision.procurement.status, message: decision.procurement.message, subjectId: "supplier" },
      { id: "commissioning", label: "Готовность монтажа", status: decision.commissioning.status, message: decision.commissioning.message, subjectId: "installer" },
      { id: "activation", label: "Готовность активации", status: decision.activation.status, message: decision.activation.message, subjectId: "supplier" },
    ],
    events: runtimeEvents.map(event => ({ id: event.id, at: event.at, actor: event.company, label: event.label,
      status: event.type, detail: event.attempt === undefined ? event.detail : `${event.detail} · попытка ${event.attempt}` })),
    contract: { id: session.id, revision: session.scopeRevision,
      totalCents: session.terms.agreementInstalledCents + session.terms.agreementAnnualSaasCents,
      remainingCents: session.terms.agreementInstalledCents + session.terms.agreementAnnualSaasCents - session.terms.depositCents, currency: "EUR" },
    knowledge: { label: "Синтетические утверждения; источник данных не аутентифицирован DNA",
      assumptions: ["Все компании, деньги и события вымышлены.", "Доступность кнопки не является полномочием: сервер повторно проверяет действие.",
        "Договорные суммы взяты из authority; они не означают признанную выручку или прибыль."],
      facts: evaluation.report.values.map(value => ({ id: value.id, label: value.id.replace(/^network\.(state|economics)\./u, ""),
        status: value.status,
        value: value.status === "known" ? (typeof value.value === "string" ? value.value : JSON.stringify(value.value)) :
          value.status === "unknown" ? "Неизвестно" : value.status === "conflict" ? "Конфликт" : "Ошибка",
        provenance: value.origins.map(origin => JSON.stringify({ fact: origin.fact, ...origin.provenance })),
        causes: value.status === "known" ? [] : [...value.causes] })),
    },
  };
  return validateUiIR(result);
}
