import { type Assertion, type Check, type Definition, type Entity, type Fact, type Provenance,
  type Value, validateAssertion } from "./definitions.ts";
import { nonempty } from "./schema.ts";

export type Basis = "none" | "assumptions" | "observations" | "mixed";
export type Origin = Readonly<{ fact: string; provenance: Provenance }>;
interface Trace { readonly id: string; readonly basis: Basis; readonly origins: readonly Origin[] }
export type ValueResult<T = unknown> =
  | (Trace & Readonly<{ status: "known"; value: T }>)
  | (Trace & Readonly<{ status: "unknown" | "conflict" | "error"; causes: readonly string[]; message: string }>);
export type CheckResult = Trace & Readonly<{
  kind: Check["kind"];
  status: "pass" | "fail" | "unknown" | "conflict" | "error";
  conclusion: "satisfied" | "violated" | "supported" | "refuted" | "conditional" | "inconclusive";
  description: string;
  message: string;
}>;
export interface ModelOptions {
  readonly id: string;
  readonly version: string;
  readonly entities?: readonly Entity[];
  readonly values?: readonly Value[];
  readonly checks?: readonly Check[];
}
export interface AssertOptions {
  /** Reject both passing and failing assumption-based conclusions as evidence gates. */
  readonly requireObservations?: boolean;
  /** Also require unused/unreferenced declared fields to be known. */
  readonly requireComplete?: boolean;
}

function originsOf(results: readonly Trace[]): readonly Origin[] {
  const origins = results.flatMap(result => result.origins);
  return Object.freeze([...new Map(origins.map(origin => [JSON.stringify(origin), origin])).values()]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function basisOf(origins: readonly Origin[]): Basis {
  const kinds = new Set(origins.map(origin => origin.provenance.kind));
  return kinds.size === 0 ? "none" : kinds.size === 2 ? "mixed" : kinds.has("assumption") ? "assumptions" : "observations";
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function dependencyIds(node: Definition): Readonly<Record<string, string>> {
  return node.kind === "fact" ? {} : Object.fromEntries(Object.entries(node.dependencies).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, value.id]));
}

/** Compilation links declared dependencies. It does not analyze arbitrary JS closures. */
export class Model {
  readonly id: string;
  readonly version: string;
  readonly entities: readonly Entity[];
  readonly definitions: readonly Definition[];
  #nodes = new Map<string, Definition>();

  constructor(options: ModelOptions) {
    this.id = nonempty(options.id, "model.id");
    this.version = nonempty(options.version, "model.version");
    this.entities = Object.freeze([...(options.entities ?? [])].sort((a, b) => a.id.localeCompare(b.id)));
    const entityIds = new Set<string>();
    for (const entity of this.entities) {
      if (entityIds.has(entity.id)) throw new Error(`Duplicate entity: ${entity.id}`);
      entityIds.add(entity.id);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: Definition, path: readonly string[] = []): void => {
      nonempty(node.id, "definition.id");
      if (!["fact", "computed", "rule", "hypothesis"].includes(node.kind)) throw new Error(`Invalid definition: ${node.id}`);
      if (entityIds.has(node.id)) throw new Error(`Entity/definition ID collision: ${node.id}`);
      if (this.#nodes.has(node.id) && this.#nodes.get(node.id) !== node) throw new Error(`Duplicate definition: ${node.id}`);
      if (visiting.has(node.id)) throw new Error(`Dependency cycle: ${[...path, node.id].join(" -> ")}`);
      if (visited.has(node.id)) return;
      this.#nodes.set(node.id, node);
      visiting.add(node.id);
      if (node.kind !== "fact") {
        for (const dependency of Object.values(node.dependencies)) {
          if (dependency.kind !== "fact" && dependency.kind !== "computed") throw new Error(`${node.id}: checks cannot be value dependencies`);
          visit(dependency, [...path, node.id]);
        }
      }
      visiting.delete(node.id);
      visited.add(node.id);
    };
    for (const entity of this.entities) for (const field of Object.values(entity.fields)) visit(field);
    for (const value of options.values ?? []) visit(value);
    for (const check of options.checks ?? []) visit(check);
    this.definitions = Object.freeze([...this.#nodes.values()].sort((a, b) => a.id.localeCompare(b.id)));
    Object.freeze(this);
  }

  owns(node: Definition): void {
    if (this.#nodes.get(node.id) !== node) throw new Error(`Definition does not belong to model ${this.id}: ${node.id}`);
  }
  scenario(name: string): Scenario { return new Scenario(this, name); }

  /** Conservative transitive impact over explicitly declared edges, not code/data diffs. */
  impact(...changed: readonly Definition[]): readonly string[] {
    changed.forEach(node => this.owns(node));
    const initial = new Set(changed.map(node => node.id));
    const reached = new Set(initial);
    let added = true;
    while (added) {
      added = false;
      for (const node of this.definitions) {
        if (!reached.has(node.id) && Object.values(dependencyIds(node)).some(id => reached.has(id))) {
          reached.add(node.id); added = true;
        }
      }
    }
    return Object.freeze([...reached].filter(id => !initial.has(id)).sort());
  }

  /** Reviewable IR. Functions remain in TypeScript; this JSON is not an executable snapshot. */
  toJSON() {
    return {
      format: "dna.model/v1", id: this.id, version: this.version,
      entities: this.entities.map(entity => ({ id: entity.id, type: entity.type, version: entity.version,
        fields: Object.fromEntries(Object.entries(entity.fields).sort(([a], [b]) => a.localeCompare(b)).map(([name, field]) => [name, field.id])) })),
      definitions: this.definitions.map(node => ({ id: node.id, kind: node.kind, dependencies: dependencyIds(node),
        ...(node.kind === "fact" || node.kind === "computed" ? { schema: node.schema.json, metadata: node.metadata } : { description: node.description }),
        ...(node.kind === "fact" ? {} : { implementation: "typescript" }) })),
    };
  }
}
export function model(options: ModelOptions): Model { return new Model(options); }

type Records = ReadonlyMap<string, readonly Assertion<unknown>[]>;
export interface ScenarioWriter {
  set<T>(node: Fact<T>, assertion: Assertion<NoInfer<T>>): void;
  record<T>(node: Fact<T>, assertion: Assertion<NoInfer<T>>): void;
}
class Evaluation {
  #cache = new Map<string, ValueResult>();
  constructor(readonly records: Records) {}

  read<T>(node: Value<T>): ValueResult<T> {
    const cached = this.#cache.get(node.id);
    if (cached) return cached as ValueResult<T>;
    let result: ValueResult<T>;
    if (node.kind === "fact") {
      const assertions = this.records.get(node.id) ?? [];
      const origins = Object.freeze(assertions.map(assertion => Object.freeze({ fact: node.id, provenance: assertion.provenance })));
      const trace = { id: node.id, basis: basisOf(origins), origins };
      if (assertions.length === 0) {
        result = { ...trace, status: "unknown", causes: [node.id], message: `${node.id}: no assertion` };
      } else if (new Set(assertions.map(assertion => JSON.stringify(assertion.value))).size > 1) {
        result = { ...trace, status: "conflict", causes: [node.id], message: `${node.id}: conflicting assertions; resolve explicitly with set()` };
      } else {
        result = { ...trace, status: "known", value: assertions[0]!.value as T };
      }
    } else {
      const input = this.inputs(node.dependencies);
      const trace = { id: node.id, basis: basisOf(input.origins), origins: input.origins };
      if (input.blocker) result = { ...trace, ...input.blocker };
      else {
        try { result = { ...trace, status: "known", value: node.schema.parse(node.compute(input.values), node.id) }; }
        catch (error) { result = { ...trace, status: "error", causes: [node.id], message: messageOf(error) }; }
      }
    }
    result = Object.freeze(result.status === "known" ? result : { ...result, causes: Object.freeze([...result.causes]) });
    this.#cache.set(node.id, result);
    return result;
  }

  inputs(dependencies: Readonly<Record<string, Value>>) {
    const entries = Object.entries(dependencies).map(([name, node]) => [name, this.read(node)] as const);
    const results = entries.map(([, result]) => result);
    const origins = originsOf(results);
    const blocked = results.filter(result => result.status !== "known");
    const status = blocked.some(result => result.status === "error") ? "error" : blocked.some(result => result.status === "conflict") ? "conflict" : "unknown";
    return {
      origins,
      blocker: blocked.length === 0 ? undefined : { status: status as "error" | "conflict" | "unknown",
        causes: Object.freeze([...new Set(blocked.flatMap(result => result.causes))].sort()),
        message: blocked.map(result => result.message).join("; ") },
      values: Object.freeze(Object.fromEntries(entries.filter(([, result]) => result.status === "known")
        .map(([name, result]) => [name, result.status === "known" ? result.value : undefined]))),
    };
  }

  check(check: Check): CheckResult {
    const input = this.inputs(check.dependencies);
    const basis = basisOf(input.origins);
    let status: CheckResult["status"];
    let message: string;
    if (input.blocker) ({ status, message } = input.blocker);
    else {
      try {
        const verdict = check.test(input.values);
        if (typeof verdict === "boolean") { status = verdict ? "pass" : "fail"; message = check.description; }
        else if (verdict && ["pass", "fail", "unknown"].includes(verdict.status) && typeof verdict.message === "string") {
          ({ status, message } = verdict);
        } else throw new Error("Predicate must return a boolean or a synchronous Verdict");
      } catch (error) { status = "error"; message = messageOf(error); }
    }
    const conclusion: CheckResult["conclusion"] = status !== "pass" && status !== "fail" ? "inconclusive"
      : check.kind === "rule" ? (status === "pass" ? "satisfied" : "violated")
      : basis !== "observations" ? "conditional" : status === "pass" ? "supported" : "refuted";
    return Object.freeze({ id: check.id, kind: check.kind, description: check.description, status, conclusion,
      message, basis, origins: input.origins });
  }
}

/** Immutable scenarios: set replaces, record accumulates, fork never mutates its parent. */
export class Scenario {
  readonly model: Model;
  readonly name: string;
  #records: Records;
  constructor(model: Model, name: string, records: Records = new Map()) {
    this.model = model;
    this.name = nonempty(name, "scenario.name");
    this.#records = new Map([...records].map(([id, assertions]) => [id, Object.freeze([...assertions])]));
    Object.freeze(this);
  }
  #write<T>(node: Fact<T>, assertion: Assertion<NoInfer<T>>, append: boolean): Scenario {
    this.model.owns(node);
    if (node.kind !== "fact") throw new Error(`Only facts can receive assertions: ${node.id}`);
    const validated = validateAssertion(node, assertion);
    const records = new Map(this.#records);
    records.set(node.id, Object.freeze([...(append ? records.get(node.id) ?? [] : []), validated]));
    return new Scenario(this.model, this.name, records);
  }
  set<T>(node: Fact<T>, assertion: Assertion<NoInfer<T>>): Scenario { return this.#write(node, assertion, false); }
  record<T>(node: Fact<T>, assertion: Assertion<NoInfer<T>>): Scenario { return this.#write(node, assertion, true); }
  /** Validate many inputs with one records copy. The writer is synchronous and
   * expires before the new immutable snapshot is returned. */
  batch(write: (draft: ScenarioWriter) => undefined): Scenario {
    const records = new Map(this.#records);
    let open = true;
    const put = <T>(node: Fact<T>, assertion: Assertion<NoInfer<T>>, append: boolean) => {
      if (!open) throw new Error("Scenario batch writer is closed");
      this.model.owns(node);
      if (node.kind !== "fact") throw new Error(`Only facts can receive assertions: ${node.id}`);
      const validated = validateAssertion(node, assertion);
      records.set(node.id, Object.freeze([...(append ? records.get(node.id) ?? [] : []), validated]));
    };
    const draft: ScenarioWriter = Object.freeze({
      set: <T>(node: Fact<T>, assertion: Assertion<NoInfer<T>>) => put(node, assertion, false),
      record: <T>(node: Fact<T>, assertion: Assertion<NoInfer<T>>) => put(node, assertion, true),
    });
    try {
      if (write(draft) !== undefined) throw new Error("Scenario batch callback must be synchronous and return undefined");
    } finally { open = false; }
    return new Scenario(this.model, this.name, records);
  }
  fork(name: string): Scenario { return new Scenario(this.model, name, this.#records); }
  read<T>(node: Value<T>): ValueResult<T> { this.model.owns(node); return new Evaluation(this.#records).read(node); }
  evaluate(): Report {
    const evaluation = new Evaluation(this.#records);
    const values: ValueResult[] = [];
    const checks: CheckResult[] = [];
    for (const node of this.model.definitions) {
      if (node.kind === "fact" || node.kind === "computed") values.push(evaluation.read(node));
      else checks.push(evaluation.check(node));
    }
    return new Report(this.model.id, this.model.version, this.name, values, checks, this.toJSON().assertions);
  }
  toJSON() {
    return { format: "dna.scenario/v1", model: this.model.id, version: this.model.version, name: this.name,
      assertions: Object.fromEntries([...this.#records].sort(([a], [b]) => a.localeCompare(b))) };
  }
}

export class Report {
  readonly values: readonly ValueResult[];
  readonly checks: readonly CheckResult[];
  constructor(readonly model: string, readonly version: string, readonly scenario: string,
    values: readonly ValueResult[], checks: readonly CheckResult[],
    readonly assertions: Readonly<Record<string, readonly Assertion<unknown>[]>>) {
    this.values = Object.freeze([...values]);
    this.checks = Object.freeze([...checks]);
    Object.freeze(this.assertions);
    Object.freeze(this);
  }
  get ok(): boolean { return this.checks.length > 0 && this.checks.every(check => check.status === "pass"); }
  assert(options: AssertOptions = {}): void {
    const problems = this.checks.filter(check => check.status !== "pass").map(check => `${check.id}: ${check.status} (${check.message})`);
    if (this.checks.length === 0) problems.push("No checks declared; an empty suite is not a passing model");
    if (options.requireObservations) {
      for (const check of this.checks) if (check.basis !== "observations") problems.push(`${check.id}: requires observations, has ${check.basis}`);
    }
    if (options.requireComplete) {
      for (const value of this.values) if (value.status !== "known") problems.push(`${value.id}: ${value.status}`);
    }
    if (problems.length) throw new Error(`Scenario ${this.scenario} did not pass:\n${problems.join("\n")}`);
  }
  toJSON() {
    return { format: "dna.report/v1", model: this.model, version: this.version, scenario: this.scenario, ok: this.ok,
      values: this.values, checks: this.checks, assertions: this.assertions };
  }
}
