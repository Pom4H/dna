import { s, type Infer } from "./schema.ts";

export const authoritySchema = s.object({
  id: s.string({ minLength: 1 }), href: s.string({ minLength: 1 }),
  kind: s.enum("manufacturer", "repository", "test-report", "registry", "document", "service"),
});
export const publicEntitySchema = s.object({
  id: s.string({ minLength: 1 }), type: s.string({ minLength: 1 }),
  revision: s.string({ minLength: 1 }), name: s.string({ minLength: 1 }),
});
export const publicCapabilitySchema = s.object({
  id: s.string({ minLength: 1 }), subject: s.string({ minLength: 1 }),
  status: s.enum("available", "unavailable", "unknown"),
});
export const publicClaimSchema = s.object({
  id: s.string({ minLength: 1 }), subject: s.string({ minLength: 1 }),
  text: s.string({ minLength: 1 }), evidence: s.array(s.string({ minLength: 1 })),
});
export const publicRelationSchema = s.object({
  from: s.string({ minLength: 1 }),
  type: s.enum("has-capability", "has-interface", "compatible-with", "implemented-by", "verified-by", "supports-claim", "supersedes"),
  to: s.string({ minLength: 1 }),
});
export const contractSchema = s.object({
  dna: s.enum("1.0"), id: s.string({ minLength: 1 }), revision: s.string({ minLength: 1 }), publisher: s.string({ minLength: 1 }),
  authorities: s.array(authoritySchema), entities: s.array(publicEntitySchema),
  capabilities: s.array(publicCapabilitySchema), claims: s.array(publicClaimSchema), relations: s.array(publicRelationSchema),
});
export type DnaContract = Infer<typeof contractSchema>;
export type PublicEntity = Infer<typeof publicEntitySchema>;
export type PublicCapability = Infer<typeof publicCapabilitySchema>;
export type PublicClaim = Infer<typeof publicClaimSchema>;
export type PublicRelation = Infer<typeof publicRelationSchema>;

/** Structural validation only. Evidence references do not constitute approval. */
export function contract(input: DnaContract): DnaContract {
  const parsed = contractSchema.parse(input, "contract");
  validateReferences(parsed);
  return parsed;
}
function validateUnique(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${label}: duplicate id ${id}`);
    seen.add(id);
  }
}
function validateReferences(value: DnaContract): void {
  const ids = [...value.authorities, ...value.entities, ...value.capabilities, ...value.claims].map(item => item.id);
  validateUnique(ids, "contract nodes");
  const nodes = new Set(ids);
  const entities = new Set(value.entities.map(item => item.id));
  const capabilities = new Set(value.capabilities.map(item => item.id));
  const authorities = new Set(value.authorities.map(item => item.id));
  for (const capability of value.capabilities) {
    if (!entities.has(capability.subject)) throw new Error(`capability ${capability.id}: subject must reference an entity: ${capability.subject}`);
  }
  for (const claim of value.claims) {
    if (!entities.has(claim.subject) && !capabilities.has(claim.subject)) {
      throw new Error(`claim ${claim.id}: subject must reference an entity or capability: ${claim.subject}`);
    }
    validateUnique(claim.evidence, `claim ${claim.id} evidence`);
    for (const evidence of claim.evidence) {
      if (!authorities.has(evidence)) throw new Error(`claim ${claim.id}: unknown evidence authority ${evidence}`);
    }
  }
  validateUnique(value.relations.map(item => JSON.stringify([item.from, item.type, item.to])), "relations");
  for (const relation of value.relations) {
    if (!nodes.has(relation.from)) throw new Error(`relation: unknown from ${relation.from}`);
    if (!nodes.has(relation.to)) throw new Error(`relation: unknown to ${relation.to}`);
  }
}
export type SemanticChange = Readonly<{
  kind: "added" | "removed" | "changed";
  category: "contract" | "authority" | "entity" | "capability" | "claim" | "relation";
  id: string;
  before?: unknown;
  after?: unknown;
}>;
function relationId(value: PublicRelation): string { return `${value.from}::${value.type}::${value.to}`; }
function compareCategory<T>(category: SemanticChange["category"], before: readonly T[], after: readonly T[],
  idOf: (value: T) => string, keyOf = idOf): SemanticChange[] {
  const left = new Map(before.map(item => [keyOf(item), item]));
  const right = new Map(after.map(item => [keyOf(item), item]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes: SemanticChange[] = [];
  for (const key of keys) {
    const a = left.get(key);
    const b = right.get(key);
    if (a === undefined && b !== undefined) changes.push({ kind: "added", category, id: idOf(b), after: b });
    else if (b === undefined && a !== undefined) changes.push({ kind: "removed", category, id: idOf(a), before: a });
    else if (a !== undefined && b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ kind: "changed", category, id: idOf(b), before: a, after: b });
    }
  }
  return changes;
}
function envelope(value: DnaContract) {
  return Object.freeze({ dna: value.dna, id: value.id, publisher: value.publisher, revision: value.revision });
}
function normalizedClaim(value: PublicClaim): PublicClaim {
  return publicClaimSchema.parse({ ...value, evidence: [...value.evidence].sort() });
}
/** Descriptive change report, NOT a compatibility verdict, trust score or breaking-change classifier. */
export function semanticDiff(before: DnaContract, after: DnaContract): readonly SemanticChange[] {
  const a = contract(before);
  const b = contract(after);
  return Object.freeze([
    ...compareCategory("contract", [envelope(a)], [envelope(b)], () => "$contract"),
    ...compareCategory("authority", a.authorities, b.authorities, item => item.id),
    ...compareCategory("entity", a.entities, b.entities, item => item.id),
    ...compareCategory("capability", a.capabilities, b.capabilities, item => item.id),
    ...compareCategory("claim", a.claims.map(normalizedClaim), b.claims.map(normalizedClaim), item => item.id),
    ...compareCategory("relation", a.relations, b.relations, relationId, item => JSON.stringify([item.from, item.type, item.to])),
  ].map(change => Object.freeze(change)));
}
export const discoverySchema = s.object({
  dna: s.enum("1.0"), publisher: s.string({ minLength: 1 }), contracts: s.array(s.string({ minLength: 1 }), { minLength: 1 }),
});
export type DnaDiscovery = Infer<typeof discoverySchema>;
export function discovery(input: DnaDiscovery): DnaDiscovery { return discoverySchema.parse(input, "discovery"); }
