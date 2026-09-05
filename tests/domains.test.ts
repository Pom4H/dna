import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assumption, observation } from "../src/index.ts";
import { baseline, downside, breakEven, business } from "../examples/subscription.ts";
import { baseline as firmware, actor, controller, port, requested, allowed, operator, noData, dna } from "../examples/firmware.ts";
import { synthetic, empty, trials } from "../examples/pilot.ts";

describe("business model hypotheses", () => {
  test("baseline, downside and break-even have different modeled outcomes", () => {
    const margin = baseline.read(business.margin);
    assert.ok(margin.status === "known" && margin.value === 70_000);
    baseline.evaluate().assert();
    assert.equal(downside.evaluate().checks.find(check => check.id === business.viable.id)!.status, "fail");
    assert.equal(breakEven.evaluate().checks.find(check => check.id === business.viable.id)!.status, "fail");
  });
  test("generated sensitivity sweep agrees with an independent break-even boundary", () => {
    // Domain: contribution = $80/customer, fixed = $2,500. Break-even requires >31.25 customers.
    for (let customers = 0; customers <= 200; customers++) {
      const scenario = baseline.fork(`customers-${customers}`).set(business.account.fields.customers, assumption(customers, "Exhaustive bounded sensitivity sweep"));
      const check = scenario.evaluate().checks.find(check => check.id === business.viable.id)!;
      assert.equal(check.status === "pass", customers >= 32, `customers=${customers}`);
      assert.equal(check.conclusion, "conditional");
    }
  });
  test("more customers cannot reduce margin under positive unit contribution", () => {
    let previous = -Infinity;
    for (let customers = 0; customers < 100; customers++) {
      const result = baseline.set(business.account.fields.customers, assumption(customers, "Monotonicity check")).read(business.margin);
      assert.equal(result.status, "known");
      if (result.status === "known") { assert.ok(result.value >= previous); previous = result.value; }
    }
  });
  test("unsafe integer arithmetic is rejected even for individually valid inputs", () => {
    const result = baseline.set(business.account.fields.customers, assumption(Number.MAX_SAFE_INTEGER, "Overflow boundary")).read(business.revenue);
    assert.equal(result.status, "error");
  });
});

describe("cross-domain authorization", () => {
  test("service access passes; operators and charge-only ports fail", () => {
    firmware.evaluate().assert({ requireComplete: true });
    assert.equal(operator.evaluate().checks[0]!.status, "fail");
    assert.equal(noData.evaluate().checks[0]!.status, "fail");
  });
  test("USB data capability does not imply a firmware feature", () => {
    const scenario = firmware.set(controller.fields.firmwareUpdate, assumption(false, "Feature absent on this revision"));
    assert.equal(scenario.evaluate().checks[0]!.status, "fail");
  });
  test("Power Delivery does not control modeled data-update authorization", () => {
    const withPD = firmware.set(port.fields.powerDelivery, assumption(true, "Independent capability"));
    assert.deepEqual(withPD.read(allowed), firmware.read(allowed));
    assert.deepEqual(dna.impact(port.fields.powerDelivery), []);
  });
  test("exhaustive policy matrix covers 192 configurations", () => {
    let count = 0;
    for (const active of [false, true]) for (const role of ["operator", "service", "admin"] as const)
      for (const sameTenant of [false, true]) for (const maintenance of [false, true])
        for (const feature of [false, true]) for (const data of ["none", "usb2", "usb3", "usb4"] as const) {
          const scenario = firmware
            .set(actor.fields.active, assumption(active, "Matrix"))
            .set(actor.fields.role, assumption(role, "Matrix"))
            .set(actor.fields.tenant, assumption(sameTenant ? "tenant-a" : "tenant-b", "Matrix"))
            .set(controller.fields.mode, assumption(maintenance ? "maintenance" : "operating", "Matrix"))
            .set(controller.fields.firmwareUpdate, assumption(feature, "Matrix"))
            .set(port.fields.data, assumption(data, "Matrix"));
          const expected = active && role !== "operator" && sameTenant && maintenance && feature && data !== "none";
          const result = scenario.read(allowed);
          assert.ok(result.status === "known");
          if (result.status === "known") assert.equal(result.value, expected, JSON.stringify({ active, role, sameTenant, maintenance, feature, data }));
          count++;
        }
    assert.equal(count, 192);
  });
  test("no update request does not require permission, given all declared facts", () => {
    operator.set(requested, assumption(false, "No action requested")).evaluate().assert();
  });
});

describe("pilot decision gates", () => {
  test("no data is inconclusive and synthetic data remains conditional", () => {
    assert.equal(empty.evaluate().checks[0]!.status, "unknown");
    assert.equal(synthetic.evaluate().checks[0]!.conclusion, "conditional");
    assert.throws(() => synthetic.evaluate().assert({ requireObservations: true }));
  });
  test("a small dataset cannot pass merely because its ratio looks good", () => {
    const small = synthetic.set(trials, assumption([{ id: "one", baselineMinutes: 100, assistedMinutes: 1, correctionsIncluded: true }], "Synthetic small sample"));
    assert.equal(small.evaluate().checks[0]!.status, "unknown");
  });
  test("duplicate IDs and excluded corrections block a pilot conclusion", () => {
    const duplicate = Array.from({ length: 20 }, () => ({ id: "same", baselineMinutes: 60, assistedMinutes: 10, correctionsIncluded: true }));
    assert.equal(synthetic.set(trials, assumption(duplicate, "Duplicate fixture")).evaluate().checks[0]!.status, "unknown");
    const incomplete = duplicate.map((trial, index) => ({ ...trial, id: String(index), correctionsIncluded: index !== 0 }));
    assert.equal(synthetic.set(trials, assumption(incomplete, "Incomplete cost measurement")).evaluate().checks[0]!.status, "unknown");
  });
  test("an observation declaration can support or refute the rule on supplied data", () => {
    // These are synthetic unit-test records. The engine cannot authenticate their source.
    const evidence = { source: "fixture://pilot-unit-test", at: "2026-01-01T00:00:00Z", scope: "synthetic-test-only" };
    for (const assistedMinutes of [20, 40]) {
      const data = Array.from({ length: 20 }, (_, i) => ({ id: String(i), baselineMinutes: 60, assistedMinutes, correctionsIncluded: true }));
      const check = synthetic.set(trials, observation(data, evidence)).evaluate().checks[0]!;
      assert.equal(check.conclusion, assistedMinutes === 20 ? "supported" : "refuted");
    }
  });
});
