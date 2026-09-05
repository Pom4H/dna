import { createHook, sleep } from "workflow";
import { checkCapacity, inspect, perform, setStage, signal } from "./steps.ts";

export async function buyerProcess(id: string) {
  "use workflow";
  using inbox = createHook<{ changed: boolean }>({ token: `company:${id}:buyer` });
  const owner = await inbox.getConflict();
  if (owner) return { duplicateOf: owner.runId };
  await setStage(id, "buyer", "awaiting-payment");
  let current = await inspect(id);
  if (current.scenario !== "missing-deposit" && !current.depositReceived) {
    await sleep("2s");
    await perform(id, "buyer", "pay-deposit");
  }
  while (!(await inspect(id)).depositReceived) await inbox;
  await signal(id, "supplier");
  await setStage(id, "buyer", "awaiting-installation");
  while (!(await inspect(id)).installationCompleted) await inbox;
  await setStage(id, "buyer", "awaiting-acceptance");
  while ((await inspect(id)).acceptedRevision === null) await inbox;
  await signal(id, "supplier");
  await setStage(id, "buyer", "awaiting-activation");
  while (!(await inspect(id)).subscriptionActive) await inbox;
  await setStage(id, "buyer", "completed");
  return { company: "buyer", fulfilled: true };
}

export async function supplierProcess(id: string) {
  "use workflow";
  using inbox = createHook<{ changed: boolean }>({ token: `company:${id}:supplier` });
  const owner = await inbox.getConflict();
  if (owner) return { duplicateOf: owner.runId };
  await setStage(id, "supplier", "awaiting-deposit");
  while (!(await inspect(id)).depositReceived) await inbox;
  await setStage(id, "supplier", "reserving-kit");
  await sleep("1s");
  await perform(id, "supplier", "reserve-kit");
  await signal(id, "installer");
  await setStage(id, "supplier", "awaiting-acceptance");
  let current = await inspect(id);
  while (!current.installationCompleted || current.acceptedRevision !== current.scopeRevision) {
    await inbox; current = await inspect(id);
  }
  await setStage(id, "supplier", "activating");
  await sleep("2s");
  await perform(id, "supplier", "activate-subscription");
  await signal(id, "buyer");
  await setStage(id, "supplier", "completed");
  return { company: "supplier", activated: true };
}

export async function installerProcess(id: string) {
  "use workflow";
  using inbox = createHook<{ changed: boolean }>({ token: `company:${id}:installer` });
  const owner = await inbox.getConflict();
  if (owner) return { duplicateOf: owner.runId };
  await setStage(id, "installer", "awaiting-kit");
  while (!(await inspect(id)).kitReserved) await inbox;
  while (!(await checkCapacity(id))) {
    await setStage(id, "installer", "blocked-capacity");
    await inbox;
  }
  await perform(id, "installer", "reserve-capacity");
  await setStage(id, "installer", "installing");
  await sleep("5s");
  await perform(id, "installer", "complete-installation");
  await signal(id, "buyer");
  await signal(id, "supplier");
  await setStage(id, "installer", "completed");
  return { company: "installer", delivered: true };
}
