import { derive, type Dependencies, type Inputs, type Value } from "./definitions.ts";
import { artifact, type Artifact, type ArtifactOptions } from "./artifacts.ts";
import { s } from "./schema.ts";

export interface SemanticValue<T, K extends string> {
  readonly kind: K;
  readonly id: string;
  readonly value: Value<T>;
}

export function problem<const D extends Dependencies>(id: string, dependencies: D,
  describe: (inputs: Inputs<D>) => string): SemanticValue<string, "problem"> {
  return Object.freeze({ kind: "problem", id, value: derive(`${id}.statement`, s.string({ minLength: 1 }), dependencies, describe) });
}

export function capability<const D extends Dependencies>(id: string, dependencies: D,
  available: (inputs: Inputs<D>) => boolean): SemanticValue<boolean, "capability"> {
  return Object.freeze({ kind: "capability", id, value: derive(`${id}.available`, s.boolean, dependencies, available) });
}

export interface Claim extends SemanticValue<string, "claim"> {
  readonly evidence: readonly Value[];
}

export function claim<const D extends Dependencies>(id: string, options: {
  readonly dependencies: D;
  readonly evidence: readonly Value[];
  readonly text: (inputs: Inputs<D>) => string;
}): Claim {
  if (options.evidence.length === 0) throw new Error(`${id}: claim requires declared evidence`);
  const dependencyValues = new Set(Object.values(options.dependencies));
  for (const evidence of options.evidence) {
    if (!dependencyValues.has(evidence)) throw new Error(`${id}: evidence ${evidence.id} must be a declared dependency`);
  }
  return Object.freeze({ kind: "claim", id, evidence: Object.freeze([...options.evidence]),
    value: derive(`${id}.text`, s.string({ minLength: 1 }), options.dependencies, options.text) });
}

export function publication<const D extends Dependencies>(id: string,
  options: ArtifactOptions<D> & { readonly claims: readonly Claim[] }): Artifact {
  if (options.claims.length === 0) throw new Error(`${id}: publication requires at least one claim`);
  const dependencies = Object.values(options.dependencies);
  for (const item of options.claims) {
    if (!dependencies.includes(item.value)) throw new Error(`${id}: claim ${item.id} must be a declared dependency`);
  }
  return artifact(id, options);
}
