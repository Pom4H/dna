import { s, type Infer, type Schema } from "../../src/index.ts";
import type { CommandType, Session } from "./authority.ts";

/** Simulated instance/component identities are derived from the local session.
 * They identify no real board/chip and are neither signatures nor proof of origin.
 * Replacing components is intentionally unsupported: a future replacement model
 * must append previous/new identities and a scoped replacement receipt, never
 * overwrite the original component and historical bindings.
 */
const text = s.string({ minLength: 1, maxLength: 300 });
const integer = s.number({ min: 0, integer: true });
const falseOnly: Schema<false> = Object.freeze({
  json: Object.freeze({ const: false }),
  parse(value: unknown) {
    if (value !== false) throw new Error("Demo passport cannot claim verified physical identity");
    return false;
  },
});
const traceSchema = s.object({ kind: s.enum("order-assignment", "site-binding", "scope-acceptance", "service-activation"),
  targetId: text, receiptId: text, operationKey: text, scopeRevision: text, version: integer, at: text });
export const passportSchema = s.object({ schemaVersion: s.enum("1"), evidence: s.enum("synthetic-demo"),
  identity: s.object({ instanceId: text, identityMethod: s.enum("deterministic-session-simulation"), serial: text,
    productModelId: text, productRevision: text, bomId: text, bomRevision: text }),
  components: s.array(s.object({ kind: s.enum("board", "chip"), id: text, revision: text })),
  trace: s.array(traceSchema),
  limitations: s.object({ sourceAuthenticated: falseOnly, physicalIdentityVerified: falseOnly, replacementHistoryImplemented: falseOnly }),
});
export type ProductPassport = Infer<typeof passportSchema>;
const receiptSchema = s.object({ id: text, operationKey: text,
  type: s.enum("pay-deposit", "reserve-kit", "reserve-capacity", "complete-installation", "accept-delivery", "activate-subscription", "repair-capacity"),
  actor: s.enum("buyer", "supplier", "installer"), scopeRevision: text, version: integer, at: text, payloadDigest: text });

type Link = { kind: Infer<typeof traceSchema>["kind"]; prefix: string };
const links: Partial<Record<CommandType, Link>> = {
  "reserve-kit": { kind: "order-assignment", prefix: "DEMO-ORDER-" },
  "complete-installation": { kind: "site-binding", prefix: "DEMO-SITE-" },
  "accept-delivery": { kind: "scope-acceptance", prefix: "DEMO-SCOPE-" },
  "activate-subscription": { kind: "service-activation", prefix: "DEMO-SERVICE-" },
};

/** Pure projection; flags such as installationCompleted never create trace
 * events. A trace entry needs a matching event and receipt already in authority
 * state. Matching proves local consistency only, not source authentication.
 */
export function passportFor(session: Session): ProductPassport {
  if (typeof session.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(session.id)) throw new Error("Invalid passport session ID");
  if (!session.receipts || typeof session.receipts !== "object" || Array.isArray(session.receipts)) throw new Error("Invalid passport receipt registry");
  const events = s.array(receiptSchema).parse(session.events);
  const seen = new Set<string>();
  const trace: Infer<typeof traceSchema>[] = [];
  for (const [index, event] of events.entries()) {
    if (seen.has(event.operationKey) || event.version !== index + 1) throw new Error("Duplicate or unordered passport authority event");
    seen.add(event.operationKey);
    if (!Object.hasOwn(session.receipts, event.operationKey)) throw new Error("Passport event has no authority receipt");
    const receipt = receiptSchema.parse(session.receipts[event.operationKey]);
    if (JSON.stringify(receipt) !== JSON.stringify(event) || receipt.scopeRevision !== session.scopeRevision) throw new Error("Passport receipt and event scope disagree");
    const link = links[event.type];
    if (link) trace.push({ kind: link.kind, targetId: `${link.prefix}${session.id}${link.kind === "scope-acceptance" ? `:${receipt.scopeRevision}` : ""}`,
      receiptId: receipt.id, operationKey: receipt.operationKey, scopeRevision: receipt.scopeRevision, version: receipt.version, at: receipt.at });
  }
  if (Object.keys(session.receipts).length !== seen.size) throw new Error("Passport receipt registry has untracked entries");
  return passportSchema.parse({ schemaVersion: "1", evidence: "synthetic-demo",
    identity: { instanceId: `DEMO-INSTANCE-${session.id}`, identityMethod: "deterministic-session-simulation",
      serial: `DEMO-SERIAL-${session.id}`, productModelId: "DEMO-KONTUR-SITE-1", productRevision: "DEMO-HW-1",
      bomId: "DEMO-KONTUR-SITE-1-BOM", bomRevision: "DEMO-BOM-1" },
    components: [{ kind: "board", id: `DEMO-BOARD-${session.id}`, revision: "DEMO-BOARD-REV-1" },
      { kind: "chip", id: `DEMO-CHIP-UID-${session.id}`, revision: "DEMO-CHIP-REV-1" }],
    trace, limitations: { sourceAuthenticated: false, physicalIdentityVerified: false, replacementHistoryImplemented: false } });
}
