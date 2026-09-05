import { derive, type Computed, type Dependencies, type Inputs, type Metadata } from "./definitions.ts";
import { s } from "./schema.ts";

export const artifactSchema = s.object({
  kind: s.enum("website", "media", "schematic", "code", "firmware", "sales", "support", "document", "data"),
  path: s.string({ minLength: 1 }),
  mediaType: s.string({ minLength: 1 }),
  content: s.string(),
});

export type Artifact = ReturnType<typeof artifactSchema.parse>;
export type ArtifactKind = Artifact["kind"];

export interface ArtifactOptions<T extends ArtifactKind, D extends Dependencies> {
  readonly kind: T;
  readonly path: string;
  readonly mediaType: string;
  readonly dependencies: D;
  readonly render: (inputs: Inputs<D>) => string;
  readonly metadata?: Metadata;
}

/**
 * A deterministic, reviewable projection of domain facts into a business artifact.
 *
 * `artifact()` deliberately does not write files. The computed value remains part of
 * the model graph so impact analysis, provenance and scenario evaluation work before
 * any materialization step touches a repository, CMS, firmware tree or document store.
 */
export function artifact<const T extends ArtifactKind, const D extends Dependencies>(
  id: string,
  options: ArtifactOptions<T, D>,
): Computed<Artifact> {
  const { kind, path, mediaType, dependencies, render, metadata = {} } = options;
  return derive(id, artifactSchema, dependencies, inputs => ({
    kind,
    path,
    mediaType,
    content: render(inputs),
  }), {
    ...metadata,
    description: metadata.description ?? `${kind} projection: ${path}`,
  });
}
