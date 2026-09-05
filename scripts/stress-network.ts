import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { createNetwork, networkSnapshot, NetworkAuthority } from "../examples/company-network/scale/network.ts";

assert.equal(process.versions["bun"], "1.4.2");
const mode = process.argv[2] ?? "all";
assert(["dna", "wdk", "all"].includes(mode));
const selected = process.argv[3]?.split(",").map(Number);
const dispatchWindow = Number(process.env["DNA_SCALE_DISPATCH_WINDOW"] ?? 128);
assert(Number.isSafeInteger(dispatchWindow) && dispatchWindow >= 32 && dispatchWindow % 32 === 0);
const reportDirectory = resolve("reports/network-scale"); mkdirSync(reportDirectory, { recursive: true });
const environment = { bun: process.versions["bun"], workflow: "4.8.5", platform: platform(), os: release(),
  cpu: cpus()[0]?.model, cores: cpus().length, systemGiB: totalmem() / 1073741824,
  git: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), at: new Date().toISOString() };
const results: unknown[] = [];
const save = () => writeFileSync(join(reportDirectory, `${mode}.json`), JSON.stringify({ environment,
  evidence: "measured local software execution on synthetic connected companies; not empirical business validation",
  results }, null, 2));
function topology(network: ReturnType<typeof createNetwork>) {
  const links = new Map(network.companies.map(c => [c.id, new Set<string>()]));
  for (const o of network.orders) for (const peer of [o.supplier, o.installer]) { links.get(o.buyer)!.add(peer); links.get(peer)!.add(o.buyer); }
  const seen = new Set<string>(), pending = [network.companies[0]!.id];
  while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); pending.push(...links.get(id)!); }
  assert.equal(seen.size, network.companies.length, "Every company participates in one connected component");
  return { companies: seen.size, buyers: network.orders.length, edges: network.orders.length * 2 };
}
function dna(count: number) {
  const begin = performance.now(), network = createNetwork(count), compileMs = performance.now() - begin;
  const graph = topology(network);
  let sequentialMs: number | null = null;
  if (count <= 3000) { const t = performance.now(); const legacy = networkSnapshot(network, { sequential: true });
    sequentialMs = performance.now() - t; assert.equal(Object.keys(legacy.toJSON().assertions).length, count * 3); }
  const inputStart = performance.now(), snapshot = networkSnapshot(network), batchInputMs = performance.now() - inputStart;
  const evalStart = performance.now(), initial = snapshot.evaluate(), evaluateMs = performance.now() - evalStart;
  assert.equal(initial.checks.filter(c => c.status === "pass").length, network.orders.length);
  const serializeStart = performance.now(), bytes = Buffer.byteLength(JSON.stringify(network.model.toJSON())), irMs = performance.now() - serializeStart;
  const start = performance.now(), world = new NetworkAuthority(network);
  for (const o of network.orders) world.reserve(o.id, o.buyer);
  const allocateMs = performance.now() - start;
  const before = world.summary();
  for (const o of [...network.orders].reverse()) world.reserve(o.id, o.buyer);
  assert.deepEqual(world.summary(), before);
  assert(before.cashConserved && before.nonnegative && before.stockReconciled && before.hoursReconciled && before.blocked > 0);
  const impact = network.model.impact(network.nodes.get("supplier.0")!.fields.stock);
  assert.equal(impact.length, 8);
  const unknown = networkSnapshot(network, { omitStock: "supplier.0" }).evaluate();
  const conflict = networkSnapshot(network, { conflictStock: "supplier.0" }).evaluate();
  assert.equal(unknown.checks.filter(c => c.status === "unknown").length, 8);
  assert.equal(conflict.checks.filter(c => c.status === "conflict").length, 8);
  const result = { layer: "dna", ...graph, facts: count * 3, checks: initial.checks.length,
    compileMs, sequentialMs, batchInputMs, evaluateMs, irMs, irBytes: bytes, allocateMs,
    sharedAuthority: before, selectiveImpactChecks: impact.length, unknownChecks: 8, conflictChecks: 8,
    rssMiB: process.memoryUsage().rss / 1048576, measurementsPerSize: 1 };
  results.push(result); save(); console.log(JSON.stringify(result));
}

type Metrics = ReturnType<NetworkAuthority["summary"]> & { instanceId: string; ready: number; runs: number; attempts: number; retries: number; rssMiB: number; authorityP95Ms: number };
type Run = { company: string; runId: string; status: string };
async function wdk(count: number) {
  const network = createNetwork(count), graph = topology(network), directory = await mkdtemp(join(tmpdir(), "dna-scale-"));
  const probe = createServer(); await new Promise<void>(r => probe.listen(0, "127.0.0.1", r));
  const address = probe.address(); assert(address && typeof address !== "string"); const port = address.port;
  await new Promise<void>(r => probe.close(() => r()));
  const origin = `http://127.0.0.1:${port}`;
  const path = fileURLToPath(new URL("../examples/company-network/scale/server.ts", import.meta.url));
  let logs = "", peakRssMiB = 0;
  function launch() {
    const child = spawn(process.execPath, [path], { stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(port), DNA_SCALE_DIR: directory, DNA_SCALE_COMPANIES: String(count) } });
    child.stdout.on("data", b => { logs = (logs + String(b)).slice(-16000); });
    child.stderr.on("data", b => { logs = (logs + String(b)).slice(-16000); });
    return child;
  }
  let child = launch();
  async function stop(signal: "SIGTERM" | "SIGKILL") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise<void>(r => child.once("close", () => r())); child.kill(signal); await done;
  }
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(origin + path, { method: body ? "POST" : "GET", signal: AbortSignal.timeout(60_000),
      ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
    const json: unknown = await response.json();
    assert(response.ok, `${path} ${response.status}: ${JSON.stringify(json)}`); return json as T;
  }
  async function metrics() { const m = await request<Metrics>("/metrics"); peakRssMiB = Math.max(peakRssMiB, m.rssMiB); return m; }
  async function wait<T>(label: string, read: () => Promise<T>, check: (result: T) => boolean, timeout = 240_000) {
    const deadline = Date.now() + timeout; let lastLog = 0, last: T | undefined;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Worker exited: ${logs}`);
      try { last = await read(); } catch { await pause(500); continue; }
      if (check(last)) return last;
      if (Date.now() - lastLog > 10_000) { console.log(`[${count}] ${label}…`); lastLog = Date.now(); }
      await pause(500);
    }
    throw new Error(`Timeout ${label}: ${JSON.stringify(last).slice(0,1000)}`);
  }
  const begin = performance.now();
  try {
    await wait("startup", () => request<{ ok: boolean }>("/health"), h => h.ok);
    const runList: { company: string; runId: string }[] = [];
    for (let i = 0; i < count; i += 32) {
      runList.push(...await request<typeof runList>("/start", { companies: network.companies.slice(i, i + 32).map(c => c.id) }));
      await metrics();
      if (i % 256 === 0) console.log(`[${count}] dispatched ${runList.length} company workflows`);
      if (runList.length % dispatchWindow === 0) {
        await wait(`admission window ${runList.length}`, metrics, m => m.ready >= runList.length);
      }
    }
    assert.equal(new Set(runList.map(r => r.runId)).size, count);
    await wait("all workflows parked on durable hooks", metrics, m => m.ready === count);
    const before = await request<{ runs: Run[]; failed: Run[] }>("/runs");
    assert.equal(before.runs.filter(r => r.status === "running").length, count); assert.deepEqual(before.failed, []);
    assert.equal((await metrics()).receipts, 0);
    const parkedMs = performance.now() - begin, restartStart = performance.now();
    await stop("SIGKILL"); child = launch();
    await wait("recovery HTTP startup", () => request<{ ok: boolean }>("/health"), h => h.ok);
    const recovered = await wait("same active runs after SIGKILL", () => request<{ runs: Run[]; failed: Run[] }>("/runs"), r => r.runs.length === count);
    assert.deepEqual(recovered.runs.map(r => r.runId).sort(), runList.map(r => r.runId).sort());
    assert.deepEqual(recovered.failed, []);
    const restartMs = performance.now() - restartStart;
    for (const role of ["buyer", "other"] as const) {
      const companies = network.companies.filter(c => role === "buyer" ? c.role === "buyer" : c.role !== "buyer");
      for (let i = 0; i < companies.length; i += 32) {
        await request("/release", { companies: companies.slice(i, i + 32).map(c => c.id) }); await metrics();
      }
      await wait(`complete ${role} workflows`, () => request<{ runs: Run[]; failed: Run[] }>("/runs"), r => {
        assert.deepEqual(r.failed, []);
        return r.runs.filter(run => role === "buyer" ? run.company.startsWith("buyer.") : true).every(run => run.status === "completed");
      });
    }
    const result = await metrics();
    assert.equal(result.receipts, network.orders.length);
    assert.equal(result.retries, Math.ceil(network.orders.length / 37));
    assert(result.cashConserved && result.nonnegative && result.stockReconciled && result.hoursReconciled && result.blocked > 0);
    const beforeSecondRestart = { receipts: result.receipts, committed: result.committed, cashCents: result.cashCents };
    await stop("SIGKILL"); child = launch();
    const final = await wait("journal replay after completed allocations", metrics, m => m.ready === count);
    assert.deepEqual({ receipts: final.receipts, committed: final.committed, cashCents: final.cashCents }, beforeSecondRestart);
    await stop("SIGTERM");
    let storageBytes = 0, files = 0;
    for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
      files++; storageBytes += (await stat(join(entry.parentPath, entry.name))).size;
    }
    const summary = { layer: "wdk-local", ...graph, workflows: count, concurrentlyParked: count,
      dispatchBatch: 32, dispatchWindow, queueConcurrency: 64, parkedMs, restartMetadataMs: restartMs, totalMs: performance.now() - begin,
      peakSampledRssMiB: peakRssMiB, files, storageMiB: storageBytes / 1048576,
      allocation: result, allCompleted: true, sameRunIdsAfterRestart: true, completedLedgerRecovered: true,
      runIdDigest: createHash("sha256").update(JSON.stringify(runList)).digest("hex") };
    results.push(summary); save(); console.log(JSON.stringify(summary));
    writeFileSync(join(reportDirectory, `run-ids-${count}.json`), JSON.stringify(runList, null, 2));
  } catch (error) { console.error(logs); results.push({ layer: "wdk-local", companies: count, failed: String(error), peakSampledRssMiB: peakRssMiB }); save(); throw error; }
  finally { await stop("SIGTERM"); await rm(directory, { recursive: true, force: true }); }
}
if (mode !== "wdk") for (const count of selected ?? [1000, 3000, 10000]) dna(count);
if (mode !== "dna") for (const count of selected ?? [1000, 3000]) await wdk(count);
console.log(`Saved ${reportDirectory}/${mode}.json`);
