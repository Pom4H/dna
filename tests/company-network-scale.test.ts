import { test } from "node:test";
import assert from "node:assert/strict";
import { createNetwork, NetworkAuthority, networkSnapshot } from "../examples/company-network/scale/network.ts";

test("connected companies share stock and capacity; snapshot approval cannot oversell", () => {
  const network = createNetwork(10, { stock: 1, hours: 6 });
  const world = new NetworkAuthority(network);
  assert.equal(networkSnapshot(network).evaluate().checks.filter(c => c.status === "pass").length, 8);
  const a = network.orders[0]!, b = network.orders[1]!;
  const first = world.reserve(a.id, a.buyer);
  assert.equal(first.status, "committed");
  assert.equal(world.reserve(b.id, b.buyer).status, "blocked");
  assert.deepEqual(world.reserve(a.id, a.buyer), first);
  assert.equal(world.summary().committed, 1);
  assert.equal(world.summary().cashConserved, true);
  assert.equal(world.summary().remainingStock, 0);
  assert.equal(world.summary().remainingHours, 0);
});

test("replay preserves shared balances, receipts and accepted prices; identity is checked", () => {
  const network = createNetwork(100);
  const first = new NetworkAuthority(network);
  for (const order of network.orders) first.reserve(order.id, order.buyer);
  const second = new NetworkAuthority(network, first.records);
  assert.deepEqual(second.summary(), first.summary());
  assert.deepEqual(second.records, first.records);
  assert.throws(() => (first.records as unknown[]).push({}), /extensible|readonly|read only/i);
  assert.ok(network.orders.every(order => order.agreedPriceCents === 300_000));
  assert.throws(() => second.reserve(network.orders[0]!.id, "supplier.0"), /actor/);
  assert.throws(() => createNetwork(11));
});

test("failed journal write has no partial money, stock or receipt effects", () => {
  const network = createNetwork(10);
  const world = new NetworkAuthority(network, [], () => { throw new Error("disk failure"); });
  const before = world.summary(), order = network.orders[0]!;
  assert.throws(() => world.reserve(order.id, order.buyer), /disk failure/);
  assert.deepEqual(world.summary(), before);
});

test("unknown and conflicting shared stock block all dependent orders", () => {
  const network = createNetwork(20);
  const unknown = networkSnapshot(network, { omitStock: "supplier.0" }).evaluate();
  const conflict = networkSnapshot(network, { conflictStock: "supplier.0" }).evaluate();
  assert.equal(unknown.checks.filter(c => c.status === "unknown").length, 8);
  assert.equal(conflict.checks.filter(c => c.status === "conflict").length, 8);
  assert.equal(network.model.impact(network.nodes.get("supplier.0")!.fields.stock).length, 8);
});
