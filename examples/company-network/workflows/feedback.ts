import { createHook, sleep } from "workflow";
import { FatalError } from "workflow";
import { appendEvent, authority, runtimeSession } from "../runtime-state.ts";
import { evaluateFeedback } from "../feedback.ts";

export async function feedbackProcess(id: string) {
  "use workflow";
  using ownership = createHook({ token: `feedback:${id}` });
  const owner = await ownership.getConflict();
  if (owner) return { duplicateOf: owner.runId };
  await sleep("2s");
  return await proposeImprovement(id);
}

async function proposeImprovement(id: string) {
  "use step";
  const session = authority().getSession(id);
  const result = evaluateFeedback({ subscriptionActive: session.subscriptionActive,
    reportedRevision: session.scopeRevision, currentRevision: session.scopeRevision, kind: "export" });
  if (!result.proposal) throw new FatalError(`${result.status}: ${result.decision.message}`);
  if (!runtimeSession(id).events.some(event => event.type === "feedback-proposal"))
    appendEvent(id, { company: "supplier", type: "feedback-proposal", label: result.proposal.title,
      detail: result.proposal.description });
  return result;
}
