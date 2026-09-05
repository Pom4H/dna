import { s, type Infer } from "./schema.ts";

export const authoritySchema = s.object({
  id: s.string({ minLength: 1 }),
  href: s.string({ minLength: 1 }),
  kind: s.enum("manufacturer", "repository", "test-report", "registry", "document", "service"),
});

export const publicEntitySchema = s.object({
  id: s.string({ minLength: 1 }),
  type: s.string({ minLength: 1 }),
  revision: s.string({ minLength: 1 }),
  name: s.string({ minLength: 1 }),
});

export const publicCapabilitySchema = s.object({
  id: s.string({ minLength: 1 }),
  subject: s.string({ minLength: 1 }),
  status: s.enum("available", "unavailable", "unknown"),
});

export const publicClaimSchema = s.object({
  id: s.string({ minLength: 1 }),
  subject: s.string({ minLength: 1 }),
  text: s.string({ minLength: 1 }),
  evidence: s.array(s.string({ minLength: 1 })),
});

export const publicRelationSchema = s.object({
  from: s.string({ minLength: 1 }),
  type: s.enum("has-capability", "has-interface", "compatible-with", "implemented-by", "verified-by", "supports-claim", "supersedes"),
  to: s.string({ minLength: 1 }),
});

export const contractSchema = s.object({
  dna: s.enum("1.0"),
  id: s.string({ minLength: 1 }),
  revision: s.string({ minLength: 1 }),
  publisher: s.string({ minLength: 1 }),
  authorities: s.array(authoritySchema),
  entities: s.array(publicEntitySchema),
  capabilities: s.array(publicCapabilitySchema),
  claims: s.array(publicClaimSchema),
  relations: s.array(publicRelationSchema),
});

export type DnaContract = Infer<typeof contractSchema>;
export type PublicEntity = Infer<typeof publicEntitySchema>;
export type PublicCapability = Infer<typeof publicCapabilitySchema>;
export type PublicClaim = Infer<typeof publicClaimSchema>;
export type PublicRelation = Infer<typeof publicRelationSchema>;

export function contract(input: DnaContract): DnaContract {
  const parsed = contractSchema.parse(input, "contract");
  validateReferences(parsed);
  return parsed;
}

function validateUnique(items: readonly { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${label}: duplicate id ${item.id}`);
    seen.add(item.id);
  }
}

function validateReferences(value: DnaContract): void {
  validateUnique(value.authorities, "authorities");
  validateUnique(value.entities, "entities");
  validateUnique(value.capabilities, "capabilities");
  validateUnique(value.claims, "claims");

  const nodes = new Set([
    ...value.entities.map(item => item.id),
    ...value.capabilities.map(item => item.id),
    ...value.claims.map(item => item.id),
    ...value.authorities.map(item => item.id),
  ]);
  const authorities = new Set(value.authorities.map(item => item.id));

  for (const capability of value.capabilities) {
    if (!nodes.has(capability.subject)) throw new Error(`capability ${capability.id}: unknown subject ${capability.subject}`);
  }
  for (const claim of value.claims) {
    if (!nodes.has(claim.subject)) throw new Error(`claim ${claim.id}: unknown subject ${claim.subject}`);
    for (const evidence of claim.evidence) {
      if (!authorities.has(evidence) && !nodes.has(evidence)) throw new Error(`claim ${claim.id}: unknown evidence ${evidence}`);
    }
  }
  for (const relation of value.relations) {
    if (!nodes.has(relation.from)) throw new Error(`relation: unknown from ${relation.from}`);
    if (!nodes.has(relation.to)) throw new Error(`relation: unknown to ${relation.to}`);
  }
}

export type SemanticChange = Readonly<{
  kind: "added" | "removed" | "changed";
  category: "entity" | "capability" | "claim" | "relation";
  id: string;
  before?: unknown;
  after?: unknown;
}>;

function relationId(value: PublicRelation): string {
  return `${value.from}::${value.type}::${value.to}`;
}

function compareCategory<T>(category: SemanticChange["category"], before: readonly T[], after: readonly T[], idOf: (value: T) => string): SemanticChange[] {
  const left = new Map(before.map(item => [idOf(item), item]));
  const right = new Map(after.map(item => [idOf(item), item]));
  const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes: SemanticChange[] = [];
  for (const id of ids) {
    const a = left.get(id);
    const b = right.get(id);
    if (a === undefined) changes.push({ kind: "added", category, id, after: b });
    else if (b === undefined) changes.push({ kind: "removed", category, id, before: a });
    else if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ kind: "changed", category, id, before: a, after: b });
  }
  return changes;
}

export function semanticDiff(before: DnaContract, after: DnaContract): readonly SemanticChange[] {
  const a = contract(before);
  const b = contract(after);
  return Object.freeze([
    ...compareCategory("entity", a.entities, b.entities, item => item.id),
    ...compareCategory("capability", a.capabilities, b.capabilities, item => item.id),
    ...compareCategory("claim", a.claims, b.claims, item => item.id),
    ...compareCategory("relation", a.relations, b.relations, relationId),
  ]);
}

export const discoverySchema = s.object({
  dna: s.enum("1.0"),
  publisher: s.string({ minLength: 1 }),
  contracts: s.array(s.string({ minLength: 1 }), { minLength: 1 }),
});
export type DnaDiscovery = Infer<typeof discoverySchema>;
export function discovery(input: DnaDiscovery): DnaDiscovery { return discoverySchema.parse(input, "discovery"); }
