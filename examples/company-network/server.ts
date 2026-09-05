import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, discovery, s } from "../../src/index.ts";
import { projectCompanyUI } from "./ui-ir.ts";
import { actors, appendEvent, authority, capability, dataDirectory, evaluationFromSession, initializeRuntime,
  resolveCapability, runtimeSession, updateRuntime } from "./runtime-state.ts";
import { evaluateFeedback, type FeedbackInput } from "./feedback.ts";
import type { Actor, CommandType } from "./authority.ts";
import { evaluateCandidates } from "./evolution.ts";
import { passportFor } from "./passport.ts";
import { resolveRunOwner } from "./run-owner.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env["PORT"] ?? 3117);
const origin = `http://127.0.0.1:${port}`;
process.env["PORT"] = String(port);
process.env["WORKFLOW_TARGET_WORLD"] = "local";
process.env["WORKFLOW_LOCAL_BASE_URL"] = origin;
process.env["DNA_DEMO_DATA_DIR"] = resolve(process.env["DNA_DEMO_DATA_DIR"] ?? join(root, ".demo-data"));
process.env["WORKFLOW_LOCAL_DATA_DIR"] = join(dataDirectory(), "workflow");
const instanceId = randomUUID(), startedAt = new Date().toISOString();
const recovered = authority().listSessions().length > 0;
// The SDK's documented standalone build emits these handlers. No workflow body
// is imported or executed directly by the application server.
type Handler = { POST(request: Request): Promise<Response> };
const flow: Handler = await import(new URL(".well-known/workflow/v1/flow.js", import.meta.url).href);
const step: Handler = await import(new URL(".well-known/workflow/v1/step.js", import.meta.url).href);
const { start, getRun, getHookByToken, resumeHook } = await import("workflow/api");
const { getWorld } = await import("workflow/runtime");
const manifest: { workflows: Record<string, Record<string, { workflowId: string }>> } = JSON.parse(
  readFileSync(join(root, ".well-known/workflow/v1/manifest.json"), "utf8"));
function workflow(name: string) {
  const match = Object.values(manifest.workflows).flatMap(group => Object.entries(group)).find(([key]) => key === name)?.[1];
  if (!match) throw new Error(`Missing workflow ${name}; run the demo build`);
  return { workflowId: match.workflowId };
}
const json = (value: unknown, status = 200) => Response.json(value, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 16_384) throw new Error("Request body too large");
  return JSON.parse(text);
}
const newSessionSchema = s.object({ scenario: s.enum("baseline", "capacity", "missing-deposit"), fault: s.boolean });
const actionSchema = s.object({ sessionId: s.string({ minLength: 1, maxLength: 80 }),
  action: s.enum("pay", "accept", "repair-capacity", "feedback"), actor: s.enum("buyer", "supplier", "installer") });
async function notify(id: string) {
  await Promise.all(actors.map(async actor => {
    try { await resumeHook(`company:${id}:${actor}`, { changed: true }); }
    catch (error) {
      // No hook is expected before its registration or after completion. The
      // process reads persisted authority state when it registers/replays.
      if (!(error instanceof Error) || error.name !== "HookNotFoundError") throw error;
    }
  }));
}
const feedbackDispatches = new Map<string, Promise<void>>();
async function ownedRun(token: string, name: string, id: string) {
  try { return await getHookByToken(token); }
  catch (error) {
    if (!(error instanceof Error) || error.name !== "HookNotFoundError") throw error;
    return await start(workflow(name), [id]);
  }
}
function dispatchFeedback(id: string): Promise<void> {
  const pending = feedbackDispatches.get(id);
  if (pending) return pending;
  const task = (async () => {
    const meta = runtimeSession(id);
    if (!meta.events.some(e => e.type === "feedback-request") || meta.events.some(e => e.type === "feedback-run")) return;
    const run = await ownedRun(`feedback:${id}`, "feedbackProcess", id);
    appendEvent(id, { company: "supplier", type: "feedback-run", label: "Запущен разбор обратной связи", detail: run.runId });
  })().finally(() => feedbackDispatches.delete(id));
  feedbackDispatches.set(id, task);
  return task;
}
async function view(id?: string) {
  const store = authority();
  const session = id ? store.getSession(id) : store.listSessions().at(-1);
  if (!session) return { session: null, ui: null, workflows: [], capabilities: {},
    runtime: { engine: "Workflow SDK 4.8.5", instanceId, startedAt, recovered, local: true } };
  const meta = runtimeSession(session.id);
  const workflows = await Promise.all(meta.flows.map(async item => ({ ...item, ...await resolveRunOwner(item.runId, getRun) })));
  const feedbackRun = meta.events.find(e => e.type === "feedback-run");
  if (feedbackRun) workflows.push({ company: "supplier", stage: "feedback", ...await resolveRunOwner(feedbackRun.detail, getRun) });
  const assessed = evaluationFromSession(session);
  const ui = projectCompanyUI(session, assessed, meta.events, workflows);
  const feedbackInput: FeedbackInput = { subscriptionActive: session.subscriptionActive,
    reportedRevision: session.scopeRevision, currentRevision: session.scopeRevision, kind: "export" };
  const feedback = meta.events.some(e => e.type === "feedback-proposal") ? evaluateFeedback(feedbackInput).proposal : null;
  return { session, ui, workflows, passport: passportFor(session), decisions: assessed.decisions, graph: assessed.graph,
    capabilities: Object.fromEntries(actors.map(actor => [actor, capability(session.id, actor)])), feedback,
    runtime: { engine: "Workflow SDK 4.8.5", instanceId, startedAt, recovered, local: true,
      faultEnabled: meta.fault, faultFired: meta.faultFired, events: meta.events } };
}
async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== origin && suppliedOrigin !== `http://localhost:${port}`) return json({ error: "Foreign origin" }, 403);
  if (request.method === "POST" && url.pathname === "/.well-known/workflow/v1/flow") return flow.POST(request);
  if (request.method === "POST" && url.pathname === "/.well-known/workflow/v1/step") return step.POST(request);
  if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, instanceId, startedAt });
  if (request.method === "GET" && url.pathname === "/.well-known/dna") return json(discovery({ dna: "1.0",
    publisher: "DNA · fictional company network", contracts: [`${origin}/api/contracts`] }));
  if (request.method === "GET" && url.pathname === "/api/contracts") return json(contract({ dna: "1.0", id: "demo.company-network", revision: "1",
    publisher: "DNA · fictional company network", authorities: [{ id: "demo.runtime", href: `${origin}/api/interface`, kind: "service" }],
    entities: actors.map(id => ({ id, type: "fictional-company", revision: "1", name: { buyer: "Вектор Фабрика", supplier: "Контур", installer: "Реле Сервис" }[id] })),
    capabilities: [], claims: [], relations: [] }));
  if (request.method === "GET" && url.pathname === "/api/evolution") return json(evaluateCandidates());
  if (request.method === "GET" && url.pathname === "/api/interface") return json({ schema: "dna.demo.capabilities", version: "0.1",
    evidence: "fictional-simulation", ui: "/api/ui", state: "/api/state", model: "/api/model",
    runtime: { name: "Workflow SDK", version: "4.8.5" }, operations: ["pay", "accept", "repair-capacity", "feedback"],
    authorization: "Local demo persona capability bound to session; not real company authentication" });
  if (request.method === "GET" && ["/api/state", "/api/ui", "/api/model"].includes(url.pathname)) {
    const state = await view(url.searchParams.get("sessionId") ?? undefined);
    return json(url.pathname === "/api/ui" ? state.ui : url.pathname === "/api/model" ? ("graph" in state ? state.graph : null) : state);
  }
  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const input = newSessionSchema.parse(await body(request));
    const session = authority().createSession({ scenario: input.scenario });
    initializeRuntime(session.id, input.fault);
    for (const company of actors) {
      const run = await start(workflow(`${company}Process`), [session.id]);
      updateRuntime(session.id, state => state.flows.push({ company, runId: run.runId, stage: "starting" }));
    }
    return json(await view(session.id), 201);
  }
  if (request.method === "POST" && url.pathname === "/api/actions") {
    const input = actionSchema.parse(await body(request));
    let actor: Actor;
    try { actor = resolveCapability(input.sessionId, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""); }
    catch { return json({ error: "Роль не разрешает действие для этого договора" }, 403); }
    if (input.actor !== actor) return json({ error: "Actor does not match capability" }, 403);
    const session = authority().getSession(input.sessionId);
    if (input.action === "feedback") {
      if (actor !== "buyer" || !session.subscriptionActive) return json({ error: "Feedback requires active service and buyer role" }, 409);
      const meta = runtimeSession(session.id);
      if (!meta.events.some(e => e.type === "feedback-request")) {
        appendEvent(session.id, { company: "buyer", type: "feedback-request", label: "Заказчик запросил улучшение", detail: "Нужен экспорт данных CSV · текущий договор сохраняется" });
      }
      await dispatchFeedback(session.id);
    } else {
      const commands: Record<Exclude<typeof input.action, "feedback">, CommandType> = { pay: "pay-deposit", accept: "accept-delivery", "repair-capacity": "repair-capacity" };
      const type = commands[input.action];
      const result = authority().execute(session.id, actor, { type,
        operationKey: `${session.id}:${session.scopeRevision}:${type}`, expectedVersion: session.version, scopeRevision: session.scopeRevision });
      if (result.status === "rejected") return json({ error: result.reason }, 409);
      await notify(session.id);
    }
    return json(await view(session.id));
  }
  if (request.method === "POST" && url.pathname === "/api/restart") {
    if (process.env["DNA_DEMO_SUPERVISED"] !== "1") return json({ error: "Restart requires the demo supervisor" }, 409);
    setTimeout(() => process.exit(72), 250);
    return json({ restarting: true });
  }
  const assets: Readonly<Record<string, [string, string]>> = { "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/style.css": ["style.css", "text/css; charset=utf-8"] };
  const asset = assets[url.pathname];
  if (request.method === "GET" && asset) return new Response(readFileSync(join(root, "public", asset[0])), { headers: { "Content-Type": asset[1], "Cache-Control": "no-cache" } });
  return json({ error: "Not found" }, 404);
}
async function toRequest(input: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of input) { const buffer = Buffer.from(chunk as Uint8Array); size += buffer.length;
    if (size > 2_000_000) throw new Error("Request body too large"); chunks.push(buffer); }
  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = input.method ?? "GET";
  return new Request(`${origin}${input.url ?? "/"}`, { method, headers,
    ...(method !== "GET" && method !== "HEAD" ? { body: Buffer.concat(chunks) } : {}) });
}
const server = createServer(async (input, output) => {
  try { const result = await route(await toRequest(input));
    output.writeHead(result.status, Object.fromEntries(result.headers)); output.end(Buffer.from(await result.arrayBuffer())); }
  catch (error) { const message = error instanceof Error ? error.message : String(error);
    console.error(message); output.writeHead(400, { "Content-Type": "application/json" }); output.end(JSON.stringify({ error: message })); }
});
await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", accept); });
getWorld(); // Starts Local World's recovery only after the HTTP handlers are reachable.
// A persisted feedback request is an inbox entry. Recover the request/start gap;
// the workflow's ownership hook and proposal receipt reconcile repeated dispatch.
for (const session of authority().listSessions()) {
  if (!existsSync(join(dataDirectory(), "runtime", `${session.id}.json`))) initializeRuntime(session.id, false);
  for (const company of actors) {
    if (runtimeSession(session.id).flows.some(f => f.company === company)) continue;
    const run = await ownedRun(`company:${session.id}:${company}`, `${company}Process`, session.id);
    updateRuntime(session.id, state => state.flows.push({ company, runId: run.runId, stage: "starting" }));
  }
  await notify(session.id); // Reconcile a committed action whose wake-up was interrupted.
  await dispatchFeedback(session.id);
}
console.log(`DNA network demo ${origin} · ${instanceId}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.close(); process.exit(0); });
