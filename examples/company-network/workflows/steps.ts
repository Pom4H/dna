import { FatalError, RetryableError, getStepMetadata } from "workflow";
import { resumeHook } from "workflow/api";
import type { Actor, CommandType } from "../authority.ts";
import { appendEvent, authority, evaluation, runtimeSession, stage, updateRuntime } from "../runtime-state.ts";

export async function inspect(id: string) {
  "use step";
  return authority().getSession(id);
}
export async function setStage(id: string, actor: Actor, value: string) {
  "use step";
  stage(id, actor, value);
}
export async function checkCapacity(id: string) {
  "use step";
  return evaluation(id).decisions.commissioning.status === "pass";
}
export async function perform(id: string, actor: Actor, type: CommandType) {
  "use step";
  const store = authority(), snapshot = store.getSession(id);
  const operationKey = `${id}:${snapshot.scopeRevision}:${type}`;
  const existing = Object.hasOwn(snapshot.receipts, operationKey);
  const { attempt } = getStepMetadata();
  // A persisted receipt reconciles an earlier commit. A fresh operation must
  // pass DNA and the authority's atomic state/role/version checks again.
  if (!existing) {
    const decisions = evaluation(id).decisions;
    const gate = type === "reserve-kit" ? decisions.procurement
      : type === "reserve-capacity" ? decisions.commissioning
        : type === "activate-subscription" ? decisions.activation : undefined;
    if (gate && gate.status !== "pass") throw new FatalError(`${gate.status}: ${gate.message}`);
  }
  const result = store.execute(id, actor, { type, operationKey,
    expectedVersion: snapshot.version, scopeRevision: snapshot.scopeRevision });
  if (result.status === "rejected") throw new FatalError(result.reason ?? "Authority rejected operation");
  appendEvent(id, { company: actor, type: result.status === "duplicate" ? "reconciled" : "step-committed",
    label: result.status === "duplicate" ? "Повтор сверён с подтверждением" : "Операция подтверждена",
    detail: `${type} · ${operationKey}`, attempt });
  const runtime = runtimeSession(id);
  if (type === "reserve-kit" && runtime.fault && !runtime.faultFired) {
    updateRuntime(id, state => { state.faultFired = true; });
    stage(id, actor, "retrying");
    appendEvent(id, { company: actor, type: "fault", label: "Ответ потерян после резервирования",
      detail: "Комплект и EUR 900 уже учтены. WDK повторит шаг с тем же ключом операции.", attempt });
    throw new RetryableError("Synthetic lost acknowledgment after authority commit", { retryAfter: "4s" });
  }
  return result.receipt;
}
export async function signal(id: string, actor: Actor) {
  "use step";
  const flow = runtimeSession(id).flows.find(f => f.company === actor);
  if (flow?.stage === "completed") return;
  try { await resumeHook(`company:${id}:${actor}`, { changed: true }); }
  catch (error) {
    if (error instanceof Error && error.name === "HookNotFoundError")
      throw new RetryableError("Receiver has not registered its hook yet", { retryAfter: "1s" });
    throw error;
  }
}
