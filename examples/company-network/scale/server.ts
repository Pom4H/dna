import { createServer } from "node:http";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createNetwork, NetworkAuthority, type Allocation } from "./network.ts";
import { s } from "../../../src/index.ts";

const directory = process.env["DNA_SCALE_DIR"] ?? (() => { throw new Error("DNA_SCALE_DIR is required; scale never uses the interactive demo data"); })();
const port = Number(process.env["PORT"]), origin = `http://127.0.0.1:${port}`;
process.env["WORKFLOW_TARGET_WORLD"] = "local";
process.env["WORKFLOW_LOCAL_BASE_URL"] = origin;
process.env["WORKFLOW_LOCAL_DATA_DIR"] = join(directory, "workflow");
process.env["WORKFLOW_LOCAL_QUEUE_CONCURRENCY"] = "64";
mkdirSync(directory, { recursive: true });
const readLines = (name: string): unknown[] => {
  const path = join(directory, name);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
};
const network = createNetwork(Number(process.env["DNA_SCALE_COMPANIES"]));
const journal = openSync(join(directory, "allocations.ndjson"), "a", 0o600);
const authority = new NetworkAuthority(network, readLines("allocations.ndjson") as Allocation[], record => {
  const bytes = Buffer.from(JSON.stringify(record) + "\n");
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(journal, bytes, offset, bytes.length - offset);
  fsyncSync(journal);
});
type Run = { company: string; runId: string };
const runs = readLines("runs.ndjson") as Run[];
const ready = new Set(readLines("ready.ndjson") as string[]);
let attempts = 0, retries = 0;
const latencies: number[] = [];
const instanceId = randomUUID();
const { start, getRun, resumeHook } = await import("workflow/api");
const { getWorld } = await import("workflow/runtime");
type Handler = { POST(request: Request): Promise<Response> };
const flow: Handler = await import(new URL("../.well-known/workflow/v1/flow.js", import.meta.url).href);
const step: Handler = await import(new URL("../.well-known/workflow/v1/step.js", import.meta.url).href);
const manifest = JSON.parse(readFileSync(new URL("../.well-known/workflow/v1/manifest.json", import.meta.url), "utf8")) as {
  workflows: Record<string, Record<string, { workflowId: string }>> };
const descriptor = Object.values(manifest.workflows).flatMap(group => Object.entries(group)).find(([name]) => name === "scaleParticipant")?.[1];
if (!descriptor) throw new Error("Build scaleParticipant first");
const idsSchema = s.object({ companies: s.array(s.string({ minLength: 1 })) });
const operationSchema = s.object({ company: s.string({ minLength: 1 }), attempt: s.number({ integer: true, min: 1 }) });
const readySchema = s.object({ company: s.string({ minLength: 1 }) });
const members = new Set(network.companies.map(c => c.id));
const orders = new Map(network.orders.map(o => [o.buyer, o]));
const send = (value: unknown) => Response.json(value);
async function route(request: Request) {
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && path === "/.well-known/workflow/v1/flow") return flow.POST(request);
  if (request.method === "POST" && path === "/.well-known/workflow/v1/step") return step.POST(request);
  if (path === "/health") return send({ ok: true, instanceId });
  if (path === "/metrics") return send({ ...authority.summary(), instanceId, ready: ready.size, runs: runs.length,
    attempts, retries, rssMiB: process.memoryUsage().rss / 1048576,
    authorityP95Ms: [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length * .95)] ?? 0 });
  if (path === "/runs") {
    const statuses = await Promise.all(runs.map(async run => ({ ...run, status: await getRun(run.runId).status })));
    return send({ runs: statuses, failed: statuses.filter(r => ["failed", "canceled", "cancelled"].includes(r.status)) });
  }
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (path === "/start" || path === "/release") {
    const { companies } = idsSchema.parse(await request.json());
    if (companies.length > 64 || companies.some(c => !members.has(c))) throw new Error("Invalid company batch");
    const result = await Promise.all(companies.map(async company => {
      if (path === "/release") { await resumeHook(`scale:${company}`, { authorizedSimulation: true }); return company; }
      if (runs.some(r => r.company === company)) throw new Error("Company already dispatched");
      const run = await start(descriptor!, [company]);
      const item = { company, runId: run.runId };
      appendFileSync(join(directory, "runs.ndjson"), JSON.stringify(item) + "\n"); runs.push(item);
      return item;
    }));
    return send(result);
  }
  if (path === "/scale/ready") {
    const { company } = readySchema.parse(await request.json());
    if (!members.has(company)) throw new Error("Unknown company");
    if (!ready.has(company)) { appendFileSync(join(directory, "ready.ndjson"), JSON.stringify(company) + "\n"); ready.add(company); }
    return send({ ready: true });
  }
  if (path === "/scale/operate") {
    const { company, attempt } = operationSchema.parse(await request.json());
    if (!members.has(company)) throw new Error("Unknown company");
    attempts++; if (attempt > 1) retries++;
    const started = performance.now(), order = orders.get(company);
    const result = order ? authority.reserve(order.id, company) : authority.audit(company);
    latencies.push(performance.now() - started);
    return send(result);
  }
  return new Response("Not found", { status: 404 });
}
const server = createServer(async (input, output) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of input) chunks.push(Buffer.from(chunk as Uint8Array));
    const method = input.method ?? "GET";
    const headers = new Headers();
    for (const [name, value] of Object.entries(input.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }
    const request = new Request(origin + input.url, { method, headers,
      ...(method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
    const result = await route(request);
    output.writeHead(result.status, Object.fromEntries(result.headers)); output.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) { output.writeHead(500); output.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
});
await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
getWorld();
console.log(JSON.stringify({ scaleReady: origin, instanceId, companies: network.companies.length }));
process.on("SIGTERM", () => { closeSync(journal); server.close(); process.exit(0); });
