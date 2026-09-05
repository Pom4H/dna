import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createStore, type Actor, type Session } from "./authority.ts";
import { evaluateBusiness } from "./model.ts";

export const actors: readonly Actor[] = ["buyer", "supplier", "installer"];
export type RuntimeEvent = { id: string; at: string; company: Actor; type: string; label: string; detail: string; attempt?: number };
export type Flow = { company: Actor; runId: string; stage: string };
export type RuntimeSession = { id: string; fault: boolean; faultFired: boolean; flows: Flow[]; events: RuntimeEvent[] };
export function dataDirectory() { return resolve(process.env["DNA_DEMO_DATA_DIR"] ?? ".demo-data"); }
export function authority() { return createStore(join(dataDirectory(), "sessions")); }
function metaPath(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid session ID");
  const directory = join(dataDirectory(), "runtime");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, `${id}.json`);
}
export function saveRuntime(state: RuntimeSession) {
  const file = metaPath(state.id), temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, file);
  return state;
}
export function runtimeSession(id: string): RuntimeSession {
  return JSON.parse(readFileSync(metaPath(id), "utf8")) as RuntimeSession;
}
export function initializeRuntime(id: string, fault: boolean) {
  return saveRuntime({ id, fault, faultFired: false, flows: [], events: [] });
}
export function updateRuntime(id: string, update: (state: RuntimeSession) => void) {
  const state = runtimeSession(id); update(state); return saveRuntime(state);
}
export function appendEvent(id: string, event: Omit<RuntimeEvent, "id" | "at">) {
  updateRuntime(id, state => state.events.push({ ...event, id: randomUUID(), at: new Date().toISOString() }));
}
export function stage(id: string, company: Actor, value: string) {
  updateRuntime(id, state => {
    const flow = state.flows.find(f => f.company === company);
    if (flow) flow.stage = value;
  });
}
export function evaluation(id: string) {
  return evaluationFromSession(authority().getSession(id));
}
/** Evaluate exactly the captured authority snapshot, without another read. */
export function evaluationFromSession(session: Session) {
  return evaluateBusiness({ agreementInstalledCents: session.terms.agreementInstalledCents,
    agreementAnnualSaasCents: session.terms.agreementAnnualSaasCents, buyerCashCents: session.buyerCashCents,
    supplierCashCents: session.supplierCashCents, stockKits: session.stockKits,
    installerAvailableHours: session.installerAvailableHours, depositReceived: session.depositReceived,
    kitReserved: session.kitReserved, capacityReserved: session.capacityReserved, scopeValid: true,
    installationCompleted: session.installationCompleted, acceptedRevision: session.acceptedRevision,
    currentRevision: session.scopeRevision, catalogInstalledCents: 300_000,
  });
}

// Local demo personas: all three are playable in the UI. Tokens bind an action
// to a session and actor; they do not authenticate a real company or employee.
function secret() {
  mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
  const file = join(dataDirectory(), "persona-key");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  return readFileSync(file);
}
export function capability(id: string, actor: Actor) {
  const payload = Buffer.from(JSON.stringify({ id, actor })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function resolveCapability(id: string, token: string): Actor {
  for (const actor of actors) {
    const expected = Buffer.from(capability(id, actor)), actual = Buffer.from(token);
    if (actual.length === expected.length && timingSafeEqual(expected, actual)) return actor;
  }
  throw new Error("Capability does not authorize this session");
}
