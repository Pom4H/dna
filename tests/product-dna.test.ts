import { test } from "node:test";
import assert from "node:assert/strict";
import {
  architecture, app, brokenVerification, controller, datasheet, diagnosticsClaim,
  firmware, noRemoteDiagnostics, product, released, remoteDiagnosticsTestPassed,
  support, website,
} from "../examples/product-dna.ts";

function text(scenario: typeof released, value: typeof website): string {
  const result = scenario.read(value);
  assert.equal(result.status, "known");
  return result.status === "known" ? result.value.content : "";
}

test("one product reason reaches engineering, runtime, website, sales and support", () => {
  assert.match(text(released, architecture), /diagnose faults before deciding to travel/);
  assert.match(text(released, firmware), /"diagnostics":true/);
  assert.match(text(released, app), /"diagnostics": true/);
  assert.match(text(released, website), /inspect the controller before a site visit/);
  assert.match(text(released, datasheet), /inspect the controller before a site visit/);
  assert.match(text(released, support), /Inspect telemetry remotely before dispatch/);
});

test("failed verification retracts a public claim without pretending implementation disappeared", () => {
  const report = brokenVerification.evaluate();
  assert.equal(report.checks.find(check => check.id === "rule.public-capabilities-require-verification")?.status, "fail");
  assert.match(text(brokenVerification, website), /not a verified public capability/);
  assert.match(text(brokenVerification, datasheet), /not a verified public capability/);
  assert.match(text(brokenVerification, firmware), /"diagnostics":true/);
});

test("removing implementation propagates through capability and its downstream representations", () => {
  assert.match(text(noRemoteDiagnostics, firmware), /"diagnostics":false/);
  assert.match(text(noRemoteDiagnostics, app), /"diagnostics": false/);
  assert.match(text(noRemoteDiagnostics, support), /Collect symptoms manually/);
  assert.match(text(noRemoteDiagnostics, website), /not a verified public capability/);
});

test("impact explains the semantic route from implementation and verification to business surfaces", () => {
  const implementationImpact = product.impact(controller.fields.remoteDiagnosticsImplemented);
  for (const id of [
    "capability.remote-diagnostics.available",
    "verification.remote-diagnostics.verified",
    "claim.remote-diagnostics.text",
    "artifact.architecture.telemetry",
    "artifact.firmware.features",
    "artifact.app.capabilities",
    "artifact.website.product",
    "artifact.sales.datasheet",
    "artifact.support.service-flow",
  ]) assert.ok(implementationImpact.includes(id), `missing ${id}`);

  const verificationImpact = product.impact(remoteDiagnosticsTestPassed);
  assert.ok(verificationImpact.includes("verification.remote-diagnostics.verified"));
  assert.ok(verificationImpact.includes(diagnosticsClaim.value.id));
  assert.ok(verificationImpact.includes("artifact.website.product"));
  assert.ok(verificationImpact.includes("artifact.sales.datasheet"));
  assert.ok(!verificationImpact.includes("artifact.firmware.features"));
  assert.ok(!verificationImpact.includes("artifact.app.capabilities"));
});
