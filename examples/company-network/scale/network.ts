import { assumption, entity, model, rule, s } from "../../../src/index.ts";

export type Company = { id: string; role: "buyer" | "supplier" | "installer"; cash: number; stock: number; hours: number; version: number };
export type Order = { id: string; buyer: string; supplier: string; installer: string; agreedPriceCents: number; scope: string };
export const policy = Object.freeze({ deposit: 150_000, installationPrepayment: 60_000, hours: 6 });
const amount = s.number({ integer: true, min: 0, max: 1_000_000_000 });
const fields = { cash: amount, stock: amount, hours: amount };
const companyNode = (id: string) => entity(id, { type: "fictional-company", version: "1", fields });
const eligible = ({ cash, stock, hours }: { cash: number; stock: number; hours: number }) =>
  cash >= policy.deposit && stock >= 1 && hours >= policy.hours;
const sample = companyNode("allocation.input");
const local = model({ id: "allocation", version: "1", entities: [sample], checks: [rule("allocation.allowed", sample.fields, eligible)] });
const assertion = (value: number) => assumption(value, "Synthetic shared-resource network; no external evidence");

export function createNetwork(count: number, resources = { stock: 6, hours: 30 }) {
  if (!Number.isSafeInteger(count) || count < 10 || count > 100_000 || count % 10 !== 0) throw new Error("Company count must be a multiple of ten between 10 and 100000");
  amount.parse(resources.stock); amount.parse(resources.hours);
  const pools = count / 10;
  const companies: Company[] = [];
  for (const role of ["buyer", "supplier", "installer"] as const) {
    for (let i = 0; i < pools * (role === "buyer" ? 8 : 1); i++) companies.push({ id: `${role}.${i}`, role,
      cash: role === "buyer" ? 1_000_000 : role === "supplier" ? 200_000 : 0,
      stock: role === "supplier" ? resources.stock : 0, hours: role === "installer" ? resources.hours : 0, version: 0 });
  }
  const nodes = new Map(companies.map(c => [c.id, companyNode(c.id)]));
  const orders: Order[] = companies.filter(c => c.role === "buyer").map((c, i) => ({ id: `order.${i}`, buyer: c.id,
    supplier: `supplier.${i % pools}`, installer: `installer.${(i + Math.floor(i / pools)) % pools}`,
    agreedPriceCents: 300_000, scope: "accepted-1" }));
  const checks = orders.map(o => rule(`${o.id}.allocation`, { cash: nodes.get(o.buyer)!.fields.cash,
    stock: nodes.get(o.supplier)!.fields.stock, hours: nodes.get(o.installer)!.fields.hours }, eligible));
  const graph = model({ id: `shared-network-${count}`, version: "1", entities: [...nodes.values()], checks });
  return { companies, orders, nodes, model: graph };
}
export type Network = ReturnType<typeof createNetwork>;
export function networkSnapshot(network: Network, options: { omitStock?: string; conflictStock?: string; sequential?: boolean } = {}) {
  let snapshot = network.model.scenario("synthetic-shared-network");
  if (options.sequential) {
    for (const c of network.companies) for (const key of ["cash", "stock", "hours"] as const)
      snapshot = snapshot.set(network.nodes.get(c.id)!.fields[key], assertion(c[key]));
    return snapshot;
  }
  return snapshot.batch(draft => {
    for (const c of network.companies) for (const key of ["cash", "stock", "hours"] as const) {
      if (key === "stock" && c.id === options.omitStock) continue;
      const fact = network.nodes.get(c.id)!.fields[key];
      draft.set(fact, assertion(c[key]));
      if (key === "stock" && c.id === options.conflictStock) draft.record(fact, assertion(c[key] + 1));
    }
  });
}
export type Allocation = { sequence: number; orderId: string; actor: string; status: "committed" | "blocked";
  beforeVersions: number[]; scope: string; agreedPriceCents: number };

/** One authoritative event loop owns shared resources. Journal before effects;
 * retries use the order identity. This is a reservation/prepayment experiment,
 * not the full installation lifecycle from the interactive three-company demo. */
export class NetworkAuthority {
  #companies: Map<string, Company>;
  #orders: Map<string, Order>;
  #receipts = new Map<string, Allocation>();
  #records: Allocation[] = [];
  #initialCash: number;
  #initialStock: number;
  #initialHours: number;
  #persist: ((record: Allocation) => void) | undefined;
  constructor(network: Network, records: readonly Allocation[] = [], persist?: (record: Allocation) => void) {
    this.#companies = new Map(network.companies.map(c => [c.id, { ...c }]));
    this.#orders = new Map(network.orders.map(o => [o.id, { ...o }]));
    this.#initialCash = network.companies.reduce((s, c) => s + c.cash, 0);
    this.#initialStock = network.companies.reduce((s, c) => s + c.stock, 0);
    this.#initialHours = network.companies.reduce((s, c) => s + c.hours, 0);
    for (const record of records) {
      if (JSON.stringify(this.reserve(record.orderId, record.actor)) !== JSON.stringify(record)) throw new Error("Journal replay mismatch");
    }
    this.#persist = persist;
  }
  get records(): readonly Allocation[] { return Object.freeze([...this.#records]); }
  reserve(orderId: string, actor: string): Allocation {
    const o = this.#orders.get(orderId);
    if (!o || o.buyer !== actor) throw new Error("Order or actor not authorized");
    const prior = this.#receipts.get(orderId);
    if (prior) return prior;
    const buyer = this.#companies.get(o.buyer)!, supplier = this.#companies.get(o.supplier)!, installer = this.#companies.get(o.installer)!;
    const check = local.scenario(orderId).batch(d => { d.set(sample.fields.cash, assertion(buyer.cash));
      d.set(sample.fields.stock, assertion(supplier.stock)); d.set(sample.fields.hours, assertion(installer.hours)); }).evaluate().checks[0]!;
    const record: Allocation = { sequence: this.#records.length + 1, orderId, actor,
      status: check.status === "pass" ? "committed" : "blocked", beforeVersions: [buyer.version, supplier.version, installer.version],
      scope: o.scope, agreedPriceCents: o.agreedPriceCents };
    this.#persist?.(record);
    if (record.status === "committed") {
      buyer.cash -= policy.deposit; supplier.cash += policy.deposit - policy.installationPrepayment;
      installer.cash += policy.installationPrepayment; supplier.stock--; installer.hours -= policy.hours;
      buyer.version++; supplier.version++; installer.version++;
    }
    Object.freeze(record.beforeVersions); Object.freeze(record);
    this.#receipts.set(orderId, record); this.#records.push(record);
    return record;
  }
  audit(companyId: string) {
    const company = this.#companies.get(companyId);
    if (!company) throw new Error("Unknown company");
    return { ...company };
  }
  summary() {
    const companies = [...this.#companies.values()], committed = this.#records.filter(r => r.status === "committed").length;
    const cash = companies.reduce((s, c) => s + c.cash, 0), remainingStock = companies.reduce((s, c) => s + c.stock, 0),
      remainingHours = companies.reduce((s, c) => s + c.hours, 0);
    return { companies: companies.length, orders: this.#orders.size, receipts: this.#records.length, committed,
      blocked: this.#records.length - committed, cashConserved: cash === this.#initialCash, cashCents: cash, remainingStock, remainingHours,
      nonnegative: companies.every(c => c.cash >= 0 && c.stock >= 0 && c.hours >= 0),
      stockReconciled: remainingStock + committed === this.#initialStock,
      hoursReconciled: remainingHours + committed * policy.hours === this.#initialHours };
  }
}
