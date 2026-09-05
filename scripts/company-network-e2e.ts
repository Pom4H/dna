/** Actual local Workflow SDK integration, with isolated fictional state.
 * Build the demo first: bun run verify:network. This does not prove distributed
 * transactions, real-company authentication, or business/market viability.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { contract, contractSchema, discovery, discoverySchema } from "../src/index.ts";
import type { Actor, Session } from "../examples/company-network/authority.ts";
import type { FeedbackProposal } from "../examples/company-network/feedback.ts";
import type { EvolutionEvaluation } from "../examples/company-network/evolution.ts";
import { passportSchema, type ProductPassport } from "../examples/company-network/passport.ts";
import type { RuntimeSession } from "../examples/company-network/runtime-state.ts";

type Scenario = "baseline" | "capacity" | "missing-deposit";
type Action = "pay" | "accept" | "repair-capacity" | "feedback";
type View = {
  session: Session;
  workflows: readonly { company: Actor; runId: string; status: string; stage: string }[];
  capabilities: Record<Actor, string>;
  feedback: FeedbackProposal | null;
  passport: ProductPassport;
  runtime: { engine: string; instanceId: string; recovered: boolean; faultFired: boolean;
    events: readonly { id: string; type: string; company: Actor; attempt?: number }[] };
};
type HttpResult<T> = { status: number; value: T };

assert.equal(process.versions["bun"], "1.4.2", "Run this integration with the pinned Bun 1.4.2");
const demoRoot = fileURLToPath(new URL("../examples/company-network/", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "dna-network-e2e-"));
const portProbe = createServer();
await new Promise<void>((accept, reject) => { portProbe.once("error", reject); portProbe.listen(0, "127.0.0.1", accept); });
const address = portProbe.address();
assert(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((accept, reject) => portProbe.close(error => error ? reject(error) : accept()));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [join(demoRoot, "run.ts")], {
  cwd: demoRoot, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(port), DNA_DEMO_DATA_DIR: directory },
});
let logTail = "";
const capture = (chunk: Buffer) => { logTail = (logTail + chunk.toString()).slice(-24_000); };
child.stdout.on("data", capture); child.stderr.on("data", capture);
let spawnError: Error | undefined;
child.on("error", error => { spawnError = error; });
const exited = new Promise<void>(accept => child.once("close", () => accept()));
const started = Date.now();
const results: { check: string; sessionId?: string; runIds?: readonly string[] }[] = [];

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<HttpResult<T>> {
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(8_000),
  });
  return { status: response.status, value: await response.json() as T };
}
async function ok<T>(path: string, options: Parameters<typeof request>[1] = {}): Promise<T> {
  const result = await request<T>(path, options);
  assert(result.status >= 200 && result.status < 300, `${path}: HTTP ${result.status}: ${JSON.stringify(result.value)}`);
  return result.value;
}
async function waitFor<T>(description: string, read: () => Promise<T>, matches: (value: T) => boolean,
  timeout = 75_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T | undefined;
  let transient = "";
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Demo supervisor exited while ${description}: ${child.exitCode ?? child.signalCode}`);
    try { last = await read(); transient = ""; }
    catch (error) { transient = error instanceof Error ? error.message : String(error); await pause(250); continue; }
    if (matches(last)) return last;
    await pause(250);
  }
  throw new Error(`Timed out: ${description}. ${transient} Last state: ${JSON.stringify(last).slice(-10_000)}`);
}
const state = (id: string) => ok<View>(`/api/state?sessionId=${encodeURIComponent(id)}`);
const runs = (view: View) => view.workflows.filter(flow => flow.stage !== "feedback").map(flow => flow.runId).sort();
function assertHealthy(view: View) {
  assert(!view.workflows.some(flow => ["failed", "cancelled", "canceled"].includes(flow.status)),
    `Unexpected terminal workflow: ${JSON.stringify(view.workflows)}`);
}
async function waitState(id: string, description: string, condition: (view: View) => boolean): Promise<View> {
  return waitFor(description, () => state(id), view => { assertHealthy(view); return condition(view); });
}
async function start(scenario: Scenario, fault: boolean): Promise<View> {
  const view = await ok<View>("/api/sessions", { method: "POST", body: { scenario, fault } });
  assert.equal(view.workflows.length, 3, "Exactly three real company runs start");
  assert.equal(new Set(runs(view)).size, 3, "Each company owns its own run identity");
  assert.equal(view.runtime.engine, "Workflow SDK 4.8.5");
  return view;
}
async function action(view: View, command: Action, actor: Actor): Promise<View> {
  return ok<View>("/api/actions", { method: "POST", token: view.capabilities[actor],
    body: { sessionId: view.session.id, action: command, actor } });
}
function receiptCount(view: View, type: string): number { return view.session.events.filter(event => event.type === type).length; }
function assertFinalLedger(view: View) {
  assert.equal(view.session.subscriptionActive, true);
  assert.equal(view.session.acceptedRevision, view.session.scopeRevision);
  assert.equal(view.session.stockKits, 0);
  assert.equal(view.session.buyerCashCents, 850_000);
  assert.equal(view.session.supplierCashCents, 200_000);
  assert.equal(view.session.installerCashCents, 60_000);
  for (const type of ["pay-deposit", "reserve-kit", "reserve-capacity", "complete-installation", "accept-delivery", "activate-subscription"])
    assert.equal(receiptCount(view, type), 1, `${type} has exactly one authority receipt`);
  assert.equal(Object.keys(view.session.receipts).length, view.session.events.length);
}
async function acceptAndFinish(view: View): Promise<View> {
  const id = view.session.id;
  const installed = await waitState(id, "installation awaits customer acceptance", latest => latest.session.installationCompleted);
  assert.equal(installed.session.subscriptionActive, false, "Installation does not activate the subscription by itself");
  assert.equal(installed.session.acceptedRevision, null, "Customer acceptance remains explicit");
  await action(installed, "accept", "buyer");
  const finished = await waitState(id, "three company workflows complete after acceptance", latest =>
    latest.session.subscriptionActive && latest.workflows.filter(flow => flow.stage !== "feedback").every(flow => flow.status === "completed"));
  assertFinalLedger(finished);
  return finished;
}

try {
  await waitFor("HTTP startup", () => ok<{ ok: boolean }>("/api/health"), health => health.ok, 30_000);
  const empty = await ok<{ session: null; workflows: unknown[] }>("/api/state");
  assert.equal(empty.session, null, "The integration starts with no prior session");
  assert.deepEqual(empty.workflows, []);
  const discoveryPayload = await ok<unknown>("/.well-known/dna");
  const discoveryDocument = discovery(discoverySchema.parse(discoveryPayload));
  assert(discoveryDocument.contracts.includes(`${origin}/api/contracts`));
  const contractDocument = contract(contractSchema.parse(await ok<unknown>("/api/contracts")));
  assert.equal(contractDocument.entities.length, 3);
  assert.equal(contractDocument.claims.length, 0, "The public contract does not fabricate evidence-backed claims");
  assert.throws(() => contractSchema.parse({ ...contractDocument, invented: true }), "The checked public contract remains strict");
  results.push({ check: "strict public discovery and three-company contract" });

  console.log("[network] Baseline: actual retry, supervisor restart, persisted run recovery…");
  const baseline = await start("baseline", true), initialRuns = runs(baseline);
  const originalPassport = passportSchema.parse(baseline.passport);
  assert.equal(originalPassport.trace.length, 0, "A planned instance does not invent lifecycle receipts");
  const lost = await waitState(baseline.session.id, "lost acknowledgment occurs after commit", latest => latest.runtime.faultFired);
  assert.equal(lost.session.kitReserved, true);
  assert.equal(receiptCount(lost, "reserve-kit"), 1);
  const beforeRestart = lost.runtime.instanceId;
  await ok("/api/restart", { method: "POST" });
  const recovered = await waitState(baseline.session.id, "new worker recovers the original runs", latest => latest.runtime.instanceId !== beforeRestart);
  assert.equal(recovered.runtime.recovered, true);
  assert.deepEqual(runs(recovered), initialRuns, "Restart preserves the same company run IDs");
  const finished = await acceptAndFinish(recovered);
  assert(finished.runtime.events.some(event => event.type === "reconciled"), "Retry reconciles the persisted authority receipt");
  assert(finished.runtime.events.some(event => event.type === "fault"), "The actual injected fault is recorded");
  assert.deepEqual(runs(finished), initialRuns);
  const physicalTrace = passportSchema.parse(finished.passport);
  assert.deepEqual(physicalTrace.identity, originalPassport.identity, "Restart and lifecycle transitions preserve simulated physical identity");
  assert.deepEqual(physicalTrace.components, originalPassport.components);
  assert.equal(physicalTrace.evidence, "synthetic-demo");
  assert.equal(physicalTrace.limitations.sourceAuthenticated, false);
  assert.equal(physicalTrace.limitations.physicalIdentityVerified, false);
  assert.deepEqual(physicalTrace.trace.map(event => event.kind), ["order-assignment", "site-binding", "scope-acceptance", "service-activation"]);
  for (const event of physicalTrace.trace) {
    const receipt = finished.session.receipts[event.operationKey];
    assert.ok(receipt);
    assert.equal(event.receiptId, receipt.id);
    assert.equal(event.version, receipt.version);
    assert.equal(event.scopeRevision, receipt.scopeRevision);
  }
  const duplicates = await action(finished, "accept", "buyer");
  assert.deepEqual(duplicates.session, finished.session, "Duplicate acceptance does not add receipts or mutate ledger");
  results.push({ check: "lost acknowledgment + restart + same runs + one kit effect + explicit acceptance", sessionId: finished.session.id, runIds: initialRuns });
  results.push({ check: "stable simulated instance, board/chip identity and four actual authority receipt links" });

  console.log("[network] Capabilities: missing, mismatched actor and cross-session tokens are rejected…");
  const other = await start("missing-deposit", false);
  for (const candidate of [
    { token: undefined, actor: "buyer" as const, sessionId: other.session.id },
    { token: other.capabilities.buyer, actor: "installer" as const, sessionId: other.session.id },
    { token: finished.capabilities.buyer, actor: "buyer" as const, sessionId: other.session.id },
  ]) {
    const response = await request("/api/actions", { method: "POST", ...(candidate.token === undefined ? {} : { token: candidate.token }),
      body: { sessionId: candidate.sessionId, action: "pay", actor: candidate.actor } });
    assert.equal(response.status, 403);
  }
  const wrongRole = await request("/api/actions", { method: "POST", token: other.capabilities.installer,
    body: { sessionId: other.session.id, action: "pay", actor: "installer" } });
  assert.equal(wrongRole.status, 409, "A valid installer capability cannot execute the buyer operation");
  assert.deepEqual((await state(other.session.id)).session, other.session, "Rejected capabilities cause no authority effects");
  results.push({ check: "capabilities bind session and actor; operation roles are rechecked" });

  console.log("[network] Missing deposit: durable waiting produces no authority effects until buyer payment…");
  const unpaid = await waitState(other.session.id, "all three processes wait for payment/resources", latest =>
    latest.workflows.every(flow => ["awaiting-payment", "awaiting-deposit", "awaiting-kit"].includes(flow.stage)));
  await pause(1_000);
  const stillUnpaid = await state(unpaid.session.id);
  assert.equal(stillUnpaid.session.events.length, 0);
  assert.equal(stillUnpaid.session.depositReceived, false);
  assert.equal(stillUnpaid.session.kitReserved, false);
  assert.equal(stillUnpaid.session.subscriptionActive, false);
  await action(stillUnpaid, "pay", "buyer");
  const paid = await acceptAndFinish(stillUnpaid);
  results.push({ check: "missing deposit waits without effects; authorized payment resumes original runs", sessionId: paid.session.id, runIds: runs(paid) });

  console.log("[network] Capacity: supplier waits on installer repair; no premature completion…");
  const capacity = await start("capacity", false);
  const blocked = await waitState(capacity.session.id, "installer reports insufficient capacity", latest =>
    latest.workflows.some(flow => flow.company === "installer" && flow.stage === "blocked-capacity"));
  assert.equal(blocked.session.kitReserved, true);
  assert.equal(blocked.session.capacityReserved, false);
  assert.equal(blocked.session.installationCompleted, false);
  assert.equal(blocked.session.subscriptionActive, false);
  const repaired = await action(blocked, "repair-capacity", "installer");
  const delivered = await acceptAndFinish(repaired);
  assert.equal(receiptCount(delivered, "repair-capacity"), 1);
  assert.deepEqual(runs(delivered), runs(capacity));
  results.push({ check: "capacity blocker + installer repair + same runs continue", sessionId: delivered.session.id, runIds: runs(delivered) });

  console.log("[network] Feedback: fourth real workflow proposes a future change without rewriting accepted terms…");
  const authorityBeforeFeedback = finished.session;
  await action(finished, "feedback", "buyer");
  const feedback = await waitState(finished.session.id, "feedback workflow completes with a proposal", latest =>
    latest.feedback !== null && latest.workflows.length === 4 && latest.workflows.every(flow => flow.status === "completed"));
  assert.equal(feedback.feedback?.acceptedTermsChanged, false);
  assert.equal(feedback.feedback?.target, "future-offer");
  assert.deepEqual(feedback.session, authorityBeforeFeedback, "Feedback creates no changed agreement or authority money/stock events");
  assert.equal(new Set(feedback.workflows.map(flow => flow.runId)).size, 4);
  await action(feedback, "feedback", "buyer");
  const duplicateFeedback = await state(feedback.session.id);
  assert.equal(duplicateFeedback.workflows.length, 4, "Repeated feedback action does not dispatch another completed proposal");
  assert.equal(duplicateFeedback.runtime.events.filter(event => event.type === "feedback-proposal").length, 1);
  results.push({ check: "fourth actual feedback workflow, duplicate dispatch guard, accepted terms unchanged", sessionId: feedback.session.id,
    runIds: feedback.workflows.map(flow => flow.runId) });

  console.log("[network] Feedback dispatch gap: persisted request without a run recovers on restart…");
  const gapBefore = await state(delivered.session.id);
  assert.equal(gapBefore.workflows.length, 3);
  assert.equal(gapBefore.feedback, null);
  const metaPath = join(directory, "runtime", `${gapBefore.session.id}.json`);
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as RuntimeSession;
  assert(!meta.events.some(event => event.type === "feedback-request" || event.type === "feedback-run"));
  // Deliberate crash-window fixture: the authoritative inbox write happened,
  // while start() never ran. This is local test setup, not a forged real user.
  meta.events.push({ id: randomUUID(), at: new Date().toISOString(), company: "buyer", type: "feedback-request",
    label: "Synthetic dispatch-gap request", detail: "Fictional CSV proposal request persisted before SDK dispatch" });
  const temporary = `${metaPath}.e2e.tmp`;
  await writeFile(temporary, JSON.stringify(meta), { mode: 0o600 });
  await rename(temporary, metaPath);
  assert.equal((await state(gapBefore.session.id)).workflows.length, 3, "The injection itself does not start any SDK workflow");
  await ok("/api/restart", { method: "POST" });
  const gapRecovered = await waitState(gapBefore.session.id, "restart dispatches persisted feedback request and completes proposal", latest =>
    latest.runtime.instanceId !== gapBefore.runtime.instanceId && latest.feedback !== null &&
    latest.workflows.length === 4 && latest.workflows.every(flow => flow.status === "completed"));
  assert.deepEqual(runs(gapRecovered), runs(gapBefore), "Recovery preserves completed company run identities");
  assert.deepEqual(gapRecovered.session, gapBefore.session, "Recovered proposal cannot rewrite accepted terms or ledger");
  assert.deepEqual(gapRecovered.passport, gapBefore.passport);
  assert.equal(gapRecovered.runtime.events.filter(event => event.type === "feedback-request").length, 1);
  assert.equal(gapRecovered.runtime.events.filter(event => event.type === "feedback-run").length, 1);
  assert.equal(gapRecovered.runtime.events.filter(event => event.type === "feedback-proposal").length, 1);
  assert.equal(gapRecovered.feedback?.acceptedTermsChanged, false);
  results.push({ check: "persisted feedback request/start gap recovers via real fourth SDK run after restart", sessionId: gapRecovered.session.id,
    runIds: gapRecovered.workflows.map(flow => flow.runId) });

  const evolution = await ok<EvolutionEvaluation>("/api/evolution");
  assert.equal(evolution.candidates.length, 7);
  assert.equal(evolution.evidence, "synthetic-assumptions");
  assert(evolution.candidates.some(candidate => !candidate.feasible));
  assert(evolution.candidates.some(candidate => candidate.feasible));
  assert.deepEqual((await state(finished.session.id)).session, authorityBeforeFeedback, "Exploring future offers leaves existing commitments unchanged");
  results.push({ check: "seven future-offer candidates include counterexamples and do not mutate accepted terms" });
  console.log(JSON.stringify({ integration: "company-network-actual-workflow-sdk", ok: true, runtime: "Bun 1.4.2 / Workflow SDK 4.8.5",
    elapsedMs: Date.now() - started, checks: results,
    limits: "Synthetic local single-process authority; no distributed transaction, real authentication, market or causal validation." }, null, 2));
} catch (error) {
  console.error("[network] Isolated demo process log tail:\n" + logTail);
  throw error;
} finally {
  const pid = child.pid;
  if (pid !== undefined) {
    try { process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-pid, "SIGTERM"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
    await Promise.race([exited, pause(5_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      try { process.platform === "win32" ? child.kill("SIGKILL") : process.kill(-pid, "SIGKILL"); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
      await exited;
    }
  }
  await rm(directory, { recursive: true, force: true });
}
