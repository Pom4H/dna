import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFeedback } from "../examples/company-network/feedback.ts";
import { baselineInput, evaluateBusiness } from "../examples/company-network/model.ts";

const ready = { subscriptionActive: true, reportedRevision: "scope-1", currentRevision: "scope-1", kind: "export" } as const;

test("feedback: missing knowledge never becomes acceptance or a proposal", () => {
  for (const key of Object.keys(ready)) {
    const input: Record<string, unknown> = { ...ready };
    delete input[key];
    const result = evaluateFeedback(input);
    assert.equal(result.status, "unknown");
    assert.equal(result.proposal, undefined);
  }
});

test("feedback: inactive subscription and wrong reported scope explicitly fail", () => {
  for (const input of [{ ...ready, subscriptionActive: false }, { ...ready, reportedRevision: "old-scope" }]) {
    const result = evaluateFeedback(input);
    assert.equal(result.status, "fail");
    assert.equal(result.proposal, undefined);
  }
});

test("feedback: contradictory scoped reports remain conflict", () => {
  const result = evaluateFeedback({ ...ready, assertions: { reportedRevision: ["scope-2"] } });
  assert.equal(result.status, "conflict");
  assert.equal(result.proposal, undefined);
  assert.equal(evaluateFeedback({ ...ready, assertions: { subscriptionActive: [false, true] } }).status, "conflict");
});

test("feedback: export produces a deterministic future-offer proposal only", () => {
  const input = Object.freeze({ ...ready });
  const before = JSON.stringify(input);
  const output = evaluateFeedback(input);
  assert.equal(output.status, "pass");
  assert.equal(output.decision.status, "pass");
  assert.deepEqual(output.proposal, {
    title: "Экспорт данных CSV",
    description: "Предложение для будущей версии оффера: исследовать экспорт данных CSV. Требует отдельной оценки и решения; функция ещё не реализована и не обещана действующим клиентам.",
    target: "future-offer",
    acceptedTermsChanged: false,
  });
  assert.deepEqual(evaluateFeedback(input), output);
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
  assert.equal(JSON.stringify(input), before);
  assert.equal(output.decision.basis, "assumptions");
});

test("feedback: reliability requests service review without repricing contracts", () => {
  const original = evaluateBusiness(baselineInput).economics;
  const result = evaluateFeedback({ ...ready, kind: "reliability" });
  assert.equal(result.proposal?.target, "service-review");
  assert.equal(result.proposal?.acceptedTermsChanged, false);
  assert.deepEqual(evaluateBusiness(baselineInput).economics, original);
  assert.equal(evaluateFeedback({ ...ready, kind: "usability" }).proposal?.acceptedTermsChanged, false);
});

test("feedback: malformed supplied input and unknown extra properties are rejected", () => {
  assert.throws(() => evaluateFeedback({ ...ready, reportedRevision: "" }));
  assert.throws(() => evaluateFeedback({ ...ready, reportedRevision: "  " }));
  assert.throws(() => evaluateFeedback({ ...ready, kind: "arbitrary-code" } as never));
  assert.throws(() => evaluateFeedback({ ...ready, runCode: "doSomething()" } as never));
  const sparse: boolean[] = [true]; sparse.length = 2;
  assert.throws(() => evaluateFeedback({ ...ready, assertions: { subscriptionActive: sparse } }));
});
