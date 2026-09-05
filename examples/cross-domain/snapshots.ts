import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assumption, type Assertion, type Schema } from "../../src/index.ts";

/** Read-only fixture adapter, NOT a production integration or trusted evidence source.
 * Read outside callbacks; pin the bytes and section in each assumption's provenance.
 * A fresh build rereads the upstream snapshot. DNA never writes back to the source.
 */
export function snapshot<T>(url: URL, schema: Schema<T>) {
  const bytes = readFileSync(url, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const data = schema.parse(JSON.parse(bytes), url.pathname);
  // Stable fixture name, not a machine-specific checkout path, in provenance.
  const source = url.pathname.split("/").at(-1) ?? "snapshot";
  return Object.freeze({ data, digest,
    input<V>(value: V, section: string): Assertion<V> {
      return assumption(value, `SYNTHETIC snapshot ${source}#${section}; sha256:${digest}`);
    },
  });
}
