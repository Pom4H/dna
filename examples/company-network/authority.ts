/** Fictional single-process demo authority. NOT authentication, a distributed
 * transaction manager, or safe for concurrent processes sharing this directory.
 * Role capabilities are selected by the demo server, never inferred from DNA.
 */
import { randomUUID, createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { s } from "../../src/index.ts";
import type { Infer, Schema } from "../../src/index.ts";

const actorSchema = s.enum("buyer", "supplier", "installer");
const typeSchema = s.enum("pay-deposit", "reserve-kit", "reserve-capacity", "complete-installation", "accept-delivery", "activate-subscription", "repair-capacity");
export type Actor = Infer<typeof actorSchema>;
export type CommandType = Infer<typeof typeSchema>;
const integer = s.number({ min: 0, integer: true });
const label = s.string({ minLength: 1, maxLength: 200 });
const commandSchema = s.object({ type: typeSchema, operationKey: label, expectedVersion: integer, scopeRevision: label });
export type Command = Infer<typeof commandSchema>;

export const TERMS = Object.freeze({ agreementInstalledCents: 300_000, agreementAnnualSaasCents: 180_000,
  depositCents: 150_000, kitCostCents: 90_000, installationCostCents: 60_000, installationHours: 6 });
export const COMPANIES = Object.freeze({ buyer: "Вектор Фабрика", supplier: "Контур", installer: "Реле Сервис" });
const termsSchema = s.object({ agreementInstalledCents: integer, agreementAnnualSaasCents: integer,
  depositCents: integer, kitCostCents: integer, installationCostCents: integer, installationHours: integer });
const receiptSchema = s.object({ id: label, operationKey: label, type: typeSchema, actor: actorSchema,
  scopeRevision: label, version: integer, at: label, payloadDigest: label });
export type Receipt = Infer<typeof receiptSchema>;
const nullableString: Schema<string | null> = {
  json: { anyOf: [{ type: "string" }, { type: "null" }] },
  parse(value, path) { return value === null ? null : label.parse(value, path); },
};
const receiptsSchema: Schema<Readonly<Record<string, Receipt>>> = {
  json: { type: "object", additionalProperties: receiptSchema.json },
  parse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid receipt registry");
    return Object.freeze(Object.fromEntries(Reflect.ownKeys(value).map(key => {
      if (typeof key !== "string") throw new Error("Invalid receipt key");
      validKey(key);
      const receipt = receiptSchema.parse((value as Record<string, unknown>)[key]);
      if (receipt.operationKey !== key) throw new Error("Receipt key mismatch");
      return [key, receipt];
    })));
  },
};
const sessionSchema = s.object({ id: label, version: integer, scopeRevision: label,
  scenario: s.enum("baseline", "insufficient-capacity", "missing-deposit"), createdAt: label,
  terms: termsSchema, buyerCashCents: integer, supplierCashCents: integer, installerCashCents: integer,
  stockKits: integer, installerAvailableHours: integer, depositReceived: s.boolean, kitReserved: s.boolean,
  capacityReserved: s.boolean, installationCompleted: s.boolean, acceptedRevision: nullableString,
  subscriptionActive: s.boolean, capacityRepaired: s.boolean,
  events: s.array(receiptSchema), receipts: receiptsSchema,
});
export type Session = Infer<typeof sessionSchema>;
export type Scenario = Session["scenario"];
export type ExecuteResult = { readonly status: "committed" | "duplicate" | "rejected";
  readonly session: Session; readonly receipt?: Receipt; readonly reason?: string };
const roles: Readonly<Record<CommandType, Actor>> = { "pay-deposit": "buyer", "reserve-kit": "supplier",
  "reserve-capacity": "installer", "complete-installation": "installer", "accept-delivery": "buyer",
  "activate-subscription": "supplier", "repair-capacity": "installer" };

function validId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error("Invalid session ID");
}
function validKey(value: string) {
  if (value.length > 200 || !value.trim() || /[\u0000-\u001f]/u.test(value)) throw new Error("Invalid operation key");
}
function digest(actor: Actor, command: Command) {
  // Optimistic-lock version is attempt metadata, not the business effect. A new
  // run may reconcile the same effect using a later snapshot version.
  return createHash("sha256").update(JSON.stringify([actor, command.type, command.scopeRevision])).digest("hex");
}
function readValidated(value: unknown): Session {
  const state = sessionSchema.parse(value);
  validId(state.id);
  if (state.scopeRevision !== "scope-1" || JSON.stringify(termsSchema.parse(TERMS)) !== JSON.stringify(state.terms)) throw new Error("Immutable demo terms modified");
  if (state.events.length !== state.version || Object.keys(state.receipts).length !== state.events.length) throw new Error("Incomplete authority history");
  const types = new Set<string>();
  for (const [index, event] of state.events.entries()) {
    const receipt = state.receipts[event.operationKey];
    if (types.has(event.type) || event.version !== index + 1 || event.scopeRevision !== state.scopeRevision || event.actor !== roles[event.type] || !receipt || JSON.stringify(receipt) !== JSON.stringify(event)) throw new Error("Invalid authority history");
    if (event.payloadDigest !== digest(event.actor, { type: event.type, operationKey: event.operationKey, scopeRevision: event.scopeRevision, expectedVersion: 0 })) throw new Error("Invalid effect digest");
    types.add(event.type);
  }
  const flags: readonly [CommandType, boolean][] = [["pay-deposit", state.depositReceived], ["reserve-kit", state.kitReserved],
    ["reserve-capacity", state.capacityReserved], ["complete-installation", state.installationCompleted],
    ["accept-delivery", state.acceptedRevision !== null], ["activate-subscription", state.subscriptionActive], ["repair-capacity", state.capacityRepaired]];
  if (flags.some(([type, flag]) => types.has(type) !== flag)) throw new Error("State and receipts disagree");
  if ((state.kitReserved && !state.depositReceived) || (state.capacityReserved && !state.kitReserved) ||
    (state.installationCompleted && !state.capacityReserved) || (state.acceptedRevision !== null && (!state.installationCompleted || state.acceptedRevision !== state.scopeRevision)) ||
    (state.subscriptionActive && state.acceptedRevision !== state.scopeRevision)) throw new Error("Invalid state transition chain");
  const expectedHours = (state.capacityRepaired || state.scenario !== "insufficient-capacity" ? 8 : 4) - (state.capacityReserved ? 6 : 0);
  if (state.buyerCashCents !== 1_000_000 - (state.depositReceived ? 150_000 : 0) ||
    state.supplierCashCents !== 200_000 + (state.depositReceived ? 150_000 : 0) - (state.kitReserved ? 90_000 : 0) - (state.installationCompleted ? 60_000 : 0) ||
    state.installerCashCents !== (state.installationCompleted ? 60_000 : 0) || state.stockKits !== (state.kitReserved ? 0 : 1) || state.installerAvailableHours !== expectedHours) throw new Error("Authority ledger invariant violated");
  return state;
}

export function createStore(dataDir: string) {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pathFor = (id: string) => { validId(id); return join(directory, `${id}.json`); };
  const getSession = (id: string): Session => {
    const state = readValidated(JSON.parse(readFileSync(pathFor(id), "utf8")));
    if (state.id !== id) throw new Error("Session identity mismatch");
    return state;
  };
  const persist = (state: Session) => {
    const validated = readValidated(state);
    const destination = pathFor(validated.id);
    const temporary = join(directory, `.${validated.id}.${randomUUID()}.tmp`);
    let handle: number | undefined;
    try {
      handle = openSync(temporary, "wx", 0o600);
      writeFileSync(handle, JSON.stringify(validated, null, 2));
      fsyncSync(handle);
      closeSync(handle); handle = undefined;
      renameSync(temporary, destination);
      // Atomic rename avoids partially visible JSON. This local demo does not
      // claim cross-process locking or a power-loss durability guarantee.
    } finally {
      if (handle !== undefined) closeSync(handle);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return validated;
  };
  const createSession = (options: { id?: string; scenario?: Scenario | "capacity" } = {}): Session => {
    for (const key of Reflect.ownKeys(options)) if (key !== "id" && key !== "scenario") throw new Error("Unknown session option");
    const id = options.id ?? randomUUID();
    const scenario = options.scenario === "capacity" ? "insufficient-capacity" : options.scenario ?? "baseline";
    const path = pathFor(id);
    if (existsSync(path)) throw new Error("Session already exists");
    return persist(sessionSchema.parse({ id, version: 0, scopeRevision: "scope-1", scenario, createdAt: new Date().toISOString(),
      terms: TERMS, buyerCashCents: 1_000_000, supplierCashCents: 200_000, installerCashCents: 0,
      stockKits: 1, installerAvailableHours: scenario === "insufficient-capacity" ? 4 : 8,
      depositReceived: false, kitReserved: false, capacityReserved: false, installationCompleted: false,
      acceptedRevision: null, subscriptionActive: false, capacityRepaired: false, events: [], receipts: {} }));
  };
  const execute = (id: string, actorInput: Actor, commandInput: unknown): ExecuteResult => {
    const actor = actorSchema.parse(actorInput);
    const command = commandSchema.parse(commandInput);
    validKey(command.operationKey);
    const current = getSession(id);
    const reject = (reason: string): ExecuteResult => ({ status: "rejected", session: current, reason });
    if (roles[command.type] !== actor) return reject("wrong-actor");
    const payloadDigest = digest(actor, command);
    const prior = Object.hasOwn(current.receipts, command.operationKey) ? current.receipts[command.operationKey] : undefined;
    if (prior) return prior.payloadDigest === payloadDigest ? { status: "duplicate", session: current, receipt: prior } : reject("operation-key-conflict");
    if (command.expectedVersion !== current.version) return reject("stale-version");
    if (command.scopeRevision !== current.scopeRevision) return reject("scope-mismatch");
    if (current.events.some(event => event.type === command.type)) return reject("already-committed");
    const next = { ...current, events: [...current.events], receipts: { ...current.receipts } };
    switch (command.type) {
      case "pay-deposit":
        if (current.buyerCashCents < TERMS.depositCents) return reject("insufficient-buyer-cash");
        next.buyerCashCents -= TERMS.depositCents; next.supplierCashCents += TERMS.depositCents; next.depositReceived = true;
        break;
      case "reserve-kit":
        if (!current.depositReceived) return reject("deposit-required");
        if (current.stockKits < 1) return reject("insufficient-stock");
        if (current.supplierCashCents < TERMS.kitCostCents) return reject("insufficient-supplier-cash");
        next.stockKits--; next.supplierCashCents -= TERMS.kitCostCents; next.kitReserved = true;
        break;
      case "reserve-capacity":
        if (!current.depositReceived) return reject("deposit-required");
        if (!current.kitReserved) return reject("kit-required");
        if (current.installerAvailableHours < TERMS.installationHours) return reject("insufficient-capacity");
        if (current.supplierCashCents < TERMS.installationCostCents) return reject("insufficient-supplier-cash");
        next.installerAvailableHours -= TERMS.installationHours; next.capacityReserved = true;
        break;
      case "complete-installation":
        if (!current.kitReserved || !current.capacityReserved) return reject("resources-required");
        if (current.supplierCashCents < TERMS.installationCostCents) return reject("insufficient-supplier-cash");
        next.supplierCashCents -= TERMS.installationCostCents; next.installerCashCents += TERMS.installationCostCents;
        next.installationCompleted = true;
        break;
      case "accept-delivery":
        if (!current.installationCompleted) return reject("installation-required");
        next.acceptedRevision = command.scopeRevision;
        break;
      case "activate-subscription":
        if (current.acceptedRevision !== current.scopeRevision) return reject("acceptance-required");
        if (!current.installationCompleted) return reject("installation-required");
        next.subscriptionActive = true;
        break;
      case "repair-capacity":
        if (current.capacityReserved) return reject("capacity-already-reserved");
        if (current.installerAvailableHours >= 8) return reject("capacity-already-sufficient");
        next.installerAvailableHours = 8; next.capacityRepaired = true;
        break;
    }
    next.version++;
    const receipt: Receipt = { id: randomUUID(), operationKey: command.operationKey, type: command.type, actor,
      scopeRevision: command.scopeRevision, version: next.version, at: new Date().toISOString(), payloadDigest };
    next.events.push(receipt);
    Object.defineProperty(next.receipts, command.operationKey, { value: receipt, enumerable: true, writable: true, configurable: true });
    return { status: "committed", session: persist(next), receipt };
  };
  const listSessions = (): readonly Session[] => readdirSync(directory).filter(name => name.endsWith(".json"))
    .map(name => getSession(name.slice(0, -5))).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return Object.freeze({ createSession, getSession, listSessions, execute });
}
export type Store = ReturnType<typeof createStore>;
