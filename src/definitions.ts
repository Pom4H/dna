import { nonempty, type Infer, type Schema, type Shape } from "./schema.ts";

export type Metadata = Readonly<{ description?: string; unit?: string; source?: string }>;
export interface Fact<T> {
  readonly kind: "fact";
  readonly id: string;
  readonly schema: Schema<T>;
  readonly metadata: Metadata;
}
export type Value<T = unknown> = Fact<T> | Computed<T>;
export type Dependencies = Readonly<Record<string, Value>>;
export type Inputs<D extends Dependencies> = { readonly [K in keyof D]: D[K] extends Value<infer T> ? T : never };
export interface Computed<T> {
  readonly kind: "computed";
  readonly id: string;
  readonly schema: Schema<T>;
  readonly metadata: Metadata;
  readonly dependencies: Dependencies;
  /** Internal evaluation boundary; author with derive() for typed dependencies. */
  readonly compute: (inputs: Readonly<Record<string, unknown>>) => T;
}
export type Verdict = Readonly<{ status: "pass" | "fail" | "unknown"; message: string }>;
export type PredicateResult = boolean | Verdict;
export interface Check {
  readonly kind: "rule" | "hypothesis";
  readonly id: string;
  readonly description: string;
  readonly dependencies: Dependencies;
  readonly test: (inputs: Readonly<Record<string, unknown>>) => PredicateResult;
}
export type Definition = Value | Check;

export function fact<T>(id: string, schema: Schema<T>, metadata: Metadata = {}): Fact<T> {
  return Object.freeze({ kind: "fact", id: nonempty(id, "fact.id"), schema, metadata: Object.freeze({ ...metadata }) });
}
export function derive<T, const D extends Dependencies>(id: string, schema: Schema<T>, dependencies: D,
  compute: (inputs: Inputs<D>) => NoInfer<T>, metadata: Metadata = {}): Computed<T> {
  return Object.freeze({ kind: "computed", id: nonempty(id, "computed.id"), schema, metadata: Object.freeze({ ...metadata }),
    dependencies: Object.freeze({ ...dependencies }), compute: compute as Computed<T>["compute"] });
}
function check<const D extends Dependencies>(kind: Check["kind"], id: string, dependencies: D,
  test: (inputs: Inputs<D>) => PredicateResult, description: string): Check {
  return Object.freeze({ kind, id: nonempty(id, "check.id"), description: nonempty(description, "check.description"),
    dependencies: Object.freeze({ ...dependencies }), test: test as Check["test"] });
}
export function rule<const D extends Dependencies>(id: string, dependencies: D,
  test: (inputs: Inputs<D>) => PredicateResult, description = id): Check {
  return check("rule", id, dependencies, test, description);
}
export function hypothesis<const D extends Dependencies>(id: string, dependencies: D,
  test: (inputs: Inputs<D>) => PredicateResult, description = id): Check {
  return check("hypothesis", id, dependencies, test, description);
}
export function inconclusive(message: string): Verdict {
  return Object.freeze({ status: "unknown", message: nonempty(message, "verdict.message") });
}

export interface Entity<S extends Shape = Shape> {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  readonly fields: { readonly [K in keyof S]: Fact<Infer<S[K]>> };
}
export function entity<const S extends Shape>(id: string, options: { type: string; version: string; fields: S }): Entity<S> {
  nonempty(id, "entity.id");
  const fields = Object.fromEntries(Object.entries(options.fields).map(([key, schema]) => {
    nonempty(key, "field.name");
    return [key, fact(`${id}.${key}`, schema)];
  }));
  return Object.freeze({ id, type: nonempty(options.type, "entity.type"), version: nonempty(options.version, "entity.version"),
    fields: Object.freeze(fields) as Entity<S>["fields"] });
}

export type Assumption = Readonly<{ kind: "assumption"; reason: string }>;
export type Observation = Readonly<{ kind: "observation"; source: string; at: string; scope: string }>;
export type Provenance = Assumption | Observation;
export type Assertion<T> = Readonly<{ value: T; provenance: Provenance }>;
export function assumption<const T>(value: T, reason: string): Assertion<T> {
  return Object.freeze({ value, provenance: Object.freeze({ kind: "assumption", reason: nonempty(reason, "assumption.reason") }) });
}
export function observation<const T>(value: T, evidence: Omit<Observation, "kind">): Assertion<T> {
  const { source, at, scope } = evidence;
  nonempty(source, "observation.source");
  nonempty(scope, "observation.scope");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(at) ||
    !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at.replace(/(?<!\.\d{3})Z$/, ".000Z")) {
    throw new Error("observation.at must be a valid UTC ISO timestamp, with optional milliseconds");
  }
  return Object.freeze({ value, provenance: Object.freeze({ kind: "observation", source, at: new Date(at).toISOString(), scope }) });
}
/** Revalidate metadata at the runtime boundary, including input from JavaScript. */
export function validateAssertion<T>(node: Fact<T>, assertion: Assertion<unknown>): Assertion<T> {
  const p = assertion.provenance;
  const value = node.schema.parse(assertion.value, node.id);
  if (p?.kind === "assumption") return assumption(value, p.reason);
  if (p?.kind === "observation") return observation(value, p);
  throw new Error(`${node.id}: assertion requires assumption or observation provenance`);
}
