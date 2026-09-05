import { createHook, RetryableError, getStepMetadata } from "workflow";

export async function scaleParticipant(company: string) {
  "use workflow";
  using release = createHook({ token: `scale:${company}` });
  const owner = await release.getConflict();
  if (owner) return { duplicateOf: owner.runId };
  await scaleReady(company);
  await release;
  return await scaleOperate(company);
}
async function scaleReady(company: string) {
  "use step";
  await callScale("ready", { company });
}
async function scaleOperate(company: string) {
  "use step";
  const { attempt } = getStepMetadata();
  const result = await callScale("operate", { company, attempt });
  if (company.startsWith("buyer.") && Number(company.split(".")[1]) % 37 === 0 && attempt === 1)
    throw new RetryableError("Synthetic lost acknowledgment after shared authority operation", { retryAfter: "100ms" });
  return result;
}
async function callScale(path: string, body: unknown): Promise<unknown> {
  const base = process.env["WORKFLOW_LOCAL_BASE_URL"];
  if (!base) throw new Error("Missing scale runtime URL");
  const response = await fetch(`${base}/scale/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Scale authority HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
