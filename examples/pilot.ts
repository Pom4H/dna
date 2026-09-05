import { assumption, fact, hypothesis, inconclusive, model, s } from "../src/index.ts";

// Paired measurements would have to be supplied by a real experiment.
// Empty and synthetic data are not observations of customer demand.
export const trials = fact("pilot.trials", s.array(s.object({
  id: s.string({ minLength: 1 }),
  baselineMinutes: s.number({ min: 0.001 }),
  assistedMinutes: s.number({ min: 0.001 }),
  correctionsIncluded: s.boolean,
})));
export const faster = hypothesis("pilot.twice-as-fast", { trials }, ({ trials }) => {
  if (trials.length < 20) return inconclusive("Predeclared decision rule requires at least 20 paired trials");
  if (new Set(trials.map(trial => trial.id)).size !== trials.length) return inconclusive("Duplicate trial IDs: investigate data quality");
  if (trials.some(trial => !trial.correctionsIncluded)) return inconclusive("Timing must include review and correction effort");
  const baseline = trials.reduce((sum, trial) => sum + trial.baselineMinutes, 0);
  const assisted = trials.reduce((sum, trial) => sum + trial.assistedMinutes, 0);
  if (!Number.isFinite(baseline) || !Number.isFinite(assisted)) return inconclusive("Aggregate exceeds numeric range");
  return { status: baseline / assisted >= 2 ? "pass" : "fail",
    message: `Paired aggregate speedup: ${(baseline / assisted).toFixed(2)}x across ${trials.length} trials` };
}, "Decision rule: at least 2x aggregate speedup on paired trials, including corrections");
export const dna = model({ id: "pilot-example", version: "0.1.0", checks: [faster] });
export const empty = dna.scenario("no-evidence");
export const synthetic = dna.scenario("synthetic-pilot").set(trials, assumption(
  Array.from({ length: 20 }, (_, i) => ({ id: `synthetic-${i}`, baselineMinutes: 60, assistedMinutes: 20, correctionsIncluded: true })),
  "Synthetic timings to exercise the API; not measurements from any company"));
export const scenarios = [synthetic];
