type RunLookup = (id: string) => { status: Promise<string>; returnValue: Promise<unknown> };

/** A restarted dispatch may lose hook ownership to a recovered original run. */
export async function resolveRunOwner(runId: string, lookup: RunLookup) {
  const visited = new Set<string>();
  for (let depth = 0; depth < 16; depth++) {
    if (visited.has(runId)) throw new Error("Cyclic workflow ownership");
    visited.add(runId);
    const run = lookup(runId), status = await run.status;
    if (status === "completed") {
      const result = await run.returnValue;
      if (typeof result === "object" && result !== null && "duplicateOf" in result && typeof result.duplicateOf === "string") {
        runId = result.duplicateOf;
        continue;
      }
    }
    return { runId, status };
  }
  throw new Error("Workflow ownership chain exceeds reconciliation bound");
}
