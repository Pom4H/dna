import {
  artifact, assumption, capability, claim, derive, entity, fact, model, problem, publication, rule, s,
} from "../src/index.ts";

// Fictional industrial controller. This example follows one reason for the product
// from a customer problem to implementation, verification, public claims and artifacts.
export const serviceNeed = entity("actor.service-engineer", {
  type: "customer-role", version: "1", fields: {
    goal: s.string({ minLength: 1 }),
  },
});

export const controller = entity("product.orbit", {
  type: "industrial-controller", version: "C", fields: {
    name: s.string({ minLength: 1 }),
    remoteDiagnosticsImplemented: s.boolean,
    telemetryTransport: s.enum("none", "websocket"),
    firmwareUpdateImplemented: s.boolean,
  },
});

export const servicePort = entity("product.orbit.port.service", {
  type: "usb-c-port", version: "1", fields: {
    data: s.enum("none", "usb2"),
  },
});

export const remoteDiagnosticsTestPassed = fact("verification.remote-diagnostics.passed", s.boolean);
export const firmwareUpdateTestPassed = fact("verification.firmware-update.passed", s.boolean);

export const avoidBlindVisit = problem("problem.avoid-blind-site-visit", {
  goal: serviceNeed.fields.goal,
}, ({ goal }) => `Service engineer needs to ${goal}`);

export const remoteDiagnostics = capability("capability.remote-diagnostics", {
  implemented: controller.fields.remoteDiagnosticsImplemented,
  transport: controller.fields.telemetryTransport,
}, ({ implemented, transport }) => implemented && transport === "websocket");

export const firmwareUpdate = capability("capability.field-firmware-update", {
  implemented: controller.fields.firmwareUpdateImplemented,
  serviceData: servicePort.fields.data,
}, ({ implemented, serviceData }) => implemented && serviceData !== "none");

export const diagnosticsVerified = derive("verification.remote-diagnostics.verified", s.boolean, {
  available: remoteDiagnostics.value,
  passed: remoteDiagnosticsTestPassed,
}, ({ available, passed }) => available && passed);

export const firmwareVerified = derive("verification.firmware-update.verified", s.boolean, {
  available: firmwareUpdate.value,
  passed: firmwareUpdateTestPassed,
}, ({ available, passed }) => available && passed);

export const diagnosticsClaim = claim("claim.remote-diagnostics", {
  dependencies: { verified: diagnosticsVerified },
  evidence: [diagnosticsVerified],
  text: ({ verified }) => verified
    ? "Remote diagnostics lets service staff inspect the controller before a site visit."
    : "Remote diagnostics is not a verified public capability.",
});

export const firmwareClaim = claim("claim.field-firmware-update", {
  dependencies: { verified: firmwareVerified },
  evidence: [firmwareVerified],
  text: ({ verified }) => verified
    ? "Firmware can be maintained through the declared service data interface."
    : "Field firmware update is not a verified public capability.",
});

export const architecture = artifact("artifact.architecture.telemetry", {
  kind: "schematic", path: "engineering/orbit/telemetry.mmd", mediaType: "text/vnd.mermaid",
  dependencies: {
    problem: avoidBlindVisit.value,
    transport: controller.fields.telemetryTransport,
    diagnostics: remoteDiagnostics.value,
  },
  render: ({ problem, transport, diagnostics }) => [
    `%% reason: ${problem}`,
    "flowchart LR",
    `  DEVICE[Orbit] -->|${transport}| APP[Service UI]`,
    `  APP --> RESULT[${diagnostics ? "inspect before dispatch" : "no remote diagnosis"}]`,
  ].join("\n"),
});

export const firmware = artifact("artifact.firmware.features", {
  kind: "firmware", path: "firmware/generated/features.ts", mediaType: "text/typescript",
  dependencies: {
    diagnostics: remoteDiagnostics.value,
    firmwareUpdate: firmwareUpdate.value,
    transport: controller.fields.telemetryTransport,
  },
  render: input => `export const PRODUCT = ${JSON.stringify(input)} as const;`,
});

export const app = artifact("artifact.app.capabilities", {
  kind: "code", path: "app/generated/capabilities.json", mediaType: "application/json",
  dependencies: { diagnostics: remoteDiagnostics.value, firmwareUpdate: firmwareUpdate.value },
  render: input => JSON.stringify(input, null, 2),
});

export const website = publication("artifact.website.product", {
  kind: "website", path: "site/products/orbit.md", mediaType: "text/markdown",
  claims: [diagnosticsClaim, firmwareClaim],
  dependencies: {
    name: controller.fields.name,
    diagnostics: diagnosticsClaim.value,
    firmware: firmwareClaim.value,
  },
  render: ({ name, diagnostics, firmware }) => `# ${name}\n\n${diagnostics}\n\n${firmware}`,
});

export const datasheet = publication("artifact.sales.datasheet", {
  kind: "sales", path: "sales/orbit-datasheet.md", mediaType: "text/markdown",
  claims: [diagnosticsClaim, firmwareClaim],
  dependencies: { diagnostics: diagnosticsClaim.value, firmware: firmwareClaim.value },
  render: ({ diagnostics, firmware }) => `## Verified capabilities\n- ${diagnostics}\n- ${firmware}`,
});

export const support = artifact("artifact.support.service-flow", {
  kind: "support", path: "support/orbit.md", mediaType: "text/markdown",
  dependencies: {
    problem: avoidBlindVisit.value,
    diagnostics: remoteDiagnostics.value,
    firmwareUpdate: firmwareUpdate.value,
  },
  render: ({ problem, diagnostics, firmwareUpdate }) => [
    `Goal: ${problem}`,
    diagnostics ? "1. Inspect telemetry remotely before dispatch." : "1. Collect symptoms manually.",
    firmwareUpdate ? "2. Firmware maintenance is available through the service port." : "2. Do not offer field firmware maintenance.",
  ].join("\n"),
});

export const coherentProduct = rule("rule.public-capabilities-require-verification", {
  diagnosticsAvailable: remoteDiagnostics.value,
  diagnosticsVerified,
  firmwareAvailable: firmwareUpdate.value,
  firmwareVerified,
}, ({ diagnosticsAvailable, diagnosticsVerified, firmwareAvailable, firmwareVerified }) =>
  (!diagnosticsAvailable || diagnosticsVerified) && (!firmwareAvailable || firmwareVerified),
  "Released capabilities must have declared passing verification before publication",
);

export const product = model({
  id: "orbit-product-dna", version: "0.2.0",
  entities: [serviceNeed, controller, servicePort],
  values: [
    avoidBlindVisit.value, remoteDiagnostics.value, firmwareUpdate.value,
    diagnosticsVerified, firmwareVerified, diagnosticsClaim.value, firmwareClaim.value,
    architecture, firmware, app, website, datasheet, support,
  ],
  checks: [coherentProduct],
});

export const released = product.scenario("released")
  .set(serviceNeed.fields.goal, assumption("diagnose faults before deciding to travel", "Fictional customer problem"))
  .set(controller.fields.name, assumption("Orbit Controller", "Fictional product"))
  .set(controller.fields.remoteDiagnosticsImplemented, assumption(true, "Fictional implementation"))
  .set(controller.fields.telemetryTransport, assumption("websocket", "Fictional architecture"))
  .set(controller.fields.firmwareUpdateImplemented, assumption(true, "Fictional implementation"))
  .set(servicePort.fields.data, assumption("usb2", "Fictional hardware"))
  .set(remoteDiagnosticsTestPassed, assumption(true, "Fictional verification result"))
  .set(firmwareUpdateTestPassed, assumption(true, "Fictional verification result"));

export const brokenVerification = released.fork("diagnostics-regression")
  .set(remoteDiagnosticsTestPassed, assumption(false, "What-if regression test failed"));

export const noRemoteDiagnostics = released.fork("remove-remote-diagnostics")
  .set(controller.fields.remoteDiagnosticsImplemented, assumption(false, "What-if product decision"));

export const scenarios = [released, brokenVerification, noRemoteDiagnostics];
