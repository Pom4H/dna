import { assumption, entity, model, rule, s, type CheckResult, type Fact, type Infer, type Schema } from "../../src/index.ts";

/** A scoped, fictional feedback proposal. No persistence, code changes, pricing
 * updates or external authentication occur in this public-kernel factory. */
const revisionText = s.string({ minLength: 1, maxLength: 200 });
const revision: Schema<string> = Object.freeze({
  json: revisionText.json,
  parse(value: unknown, path?: string) {
    const parsed = revisionText.parse(value, path);
    if (!parsed.trim()) throw new Error("Feedback revision must not be blank");
    return parsed;
  },
});
const inputShape = { subscriptionActive: s.boolean, reportedRevision: revision,
  currentRevision: revision, kind: s.enum("export", "reliability", "usability") };
type FeedbackFacts = { readonly [K in keyof typeof inputShape]: Infer<typeof inputShape[K]> };
export type FeedbackInput = Partial<FeedbackFacts> & Readonly<{
  assertions?: { readonly [K in keyof FeedbackFacts]?: readonly FeedbackFacts[K][] };
}>;
export type FeedbackProposal = Readonly<{ title: string; description: string;
  target: "future-offer" | "service-review"; acceptedTermsChanged: false }>;
export type FeedbackEvaluation = Readonly<{ status: CheckResult["status"]; decision: CheckResult; proposal?: FeedbackProposal }>;

const proposals: Readonly<Record<FeedbackFacts["kind"], FeedbackProposal>> = Object.freeze({
  export: Object.freeze({ title: "Экспорт данных CSV",
    description: "Предложение для будущей версии оффера: исследовать экспорт данных CSV. Требует отдельной оценки и решения; функция ещё не реализована и не обещана действующим клиентам.",
    target: "future-offer", acceptedTermsChanged: false }),
  reliability: Object.freeze({ title: "Проверка надёжности сервиса",
    description: "Предложение проверить качество данных и журнал инцидентов по указанной версии. Сообщение клиента не устанавливает причину сбоя и не меняет принятый SLA.",
    target: "service-review", acceptedTermsChanged: false }),
  usability: Object.freeze({ title: "Улучшение удобства интерфейса",
    description: "Предложение исследовать сценарий использования для будущей версии оффера. Требует отдельного решения о разработке; согласованные функции и цены сохраняются.",
    target: "future-offer", acceptedTermsChanged: false }),
});

function plainObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Feedback input must be a plain object");
  return value as Readonly<Record<string, unknown>>;
}

export function createFeedbackModel() {
  const state = entity("network.feedback", { type: "fictional-scoped-feedback", version: "1", fields: inputShape });
  const relevance = rule("network.feedback.review-eligible", state.fields, ({ subscriptionActive, reportedRevision, currentRevision, kind }) => {
    if (!subscriptionActive) return { status: "fail", message: "Этот демонстрационный процесс ожидает обратную связь по активной подписке." };
    if (reportedRevision !== currentRevision) return { status: "fail", message: "Обратная связь относится к другой версии; необходима проверка области применимости." };
    return { status: "pass", message: `Обратная связь ${kind} относится к активной подписке и текущей версии. Можно создать предложение для рассмотрения; действующие условия не меняются.` };
  });
  const business = model({ id: "fictional-network-feedback", version: "1", entities: [state], checks: [relevance] });
  function evaluate(input: FeedbackInput): FeedbackEvaluation {
    const data = plainObject(input);
    for (const key of Reflect.ownKeys(data)) {
      if (typeof key !== "string" || (key !== "assertions" && !Object.hasOwn(inputShape, key))) throw new Error(`Unexpected feedback field: ${String(key)}`);
    }
    const additions = Object.hasOwn(data, "assertions") ? plainObject(data["assertions"]) : {};
    for (const key of Reflect.ownKeys(additions)) {
      if (typeof key !== "string" || !Object.hasOwn(inputShape, key)) throw new Error(`Unexpected feedback assertion: ${String(key)}`);
    }
    let scenario = business.scenario("synthetic-scoped-feedback");
    for (const [key, definition] of Object.entries(state.fields)) {
      // Field schemas validate original values at this heterogeneous boundary.
      const node: Fact<unknown> = definition;
      if (Object.hasOwn(data, key)) scenario = scenario.record(node, assumption(data[key], `Fictional feedback snapshot: ${key}; caller assertion, not authenticated evidence`));
      if (Object.hasOwn(additions, key)) for (const value of s.array(node.schema).parse(additions[key])) {
        scenario = scenario.record(node, assumption(value, `Fictional additional feedback assertion: ${key}`));
      }
    }
    const report = scenario.evaluate().toJSON();
    const decision = report.checks.find(check => check.id === relevance.id);
    if (!decision) throw new Error("Missing feedback check");
    if (decision.status !== "pass") return { status: decision.status, decision };
    const kindResult = report.values.find(value => value.id === state.fields.kind.id);
    if (!kindResult || kindResult.status !== "known") throw new Error("Passing feedback check has no known kind");
    const kind = inputShape.kind.parse(kindResult.value);
    return { status: decision.status, decision, proposal: proposals[kind] };
  }
  return Object.freeze({ evaluate, business, state });
}

const feedbackModel = createFeedbackModel();
export function evaluateFeedback(input: FeedbackInput): FeedbackEvaluation { return feedbackModel.evaluate(input); }
