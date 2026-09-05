import {
  artifact,
  assumption,
  entity,
  model,
  rule,
  s,
} from "../src/index.ts";

// Fictional product. The point is not the controller itself, but that the same
// declared capabilities drive every downstream representation of it.
export const controller = entity("product.orbit", {
  type: "industrial-controller",
  version: "B",
  fields: {
    name: s.string({ minLength: 1 }),
    supply: s.enum("12VDC", "24VDC"),
    ingress: s.enum("IP20", "IP54", "IP65"),
    firmwareUpdate: s.boolean,
    remoteDiagnostics: s.boolean,
  },
});

export const servicePort = entity("product.orbit.port.service", {
  type: "usb-c-port",
  version: "1",
  fields: {
    connector: s.enum("usb-c"),
    data: s.enum("none", "usb2"),
    powerDelivery: s.boolean,
  },
});

export const productConsistency = rule(
  "product.orbit.firmware-requires-data-port",
  {
    firmwareUpdate: controller.fields.firmwareUpdate,
    data: servicePort.fields.data,
  },
  ({ firmwareUpdate, data }) => !firmwareUpdate || data !== "none",
  "Firmware update capability requires a declared data-capable service port",
);

export const website = artifact("artifact.website.product-page", {
  kind: "website",
  path: "site/products/orbit.md",
  mediaType: "text/markdown",
  dependencies: {
    name: controller.fields.name,
    revision: controller.fields.ingress,
    firmwareUpdate: controller.fields.firmwareUpdate,
    remoteDiagnostics: controller.fields.remoteDiagnostics,
  },
  render: ({ name, revision, firmwareUpdate, remoteDiagnostics }) => [
    `# ${name}`,
    "",
    `Enclosure: ${revision}`,
    firmwareUpdate ? "Firmware can be updated through the declared service interface." : "Firmware update is not offered as a product capability.",
    remoteDiagnostics ? "Remote diagnostics is supported." : "Remote diagnostics is not supported.",
  ].join("\n"),
});

export const mediaBrief = artifact("artifact.media.product-brief", {
  kind: "media",
  path: "media/orbit/brief.json",
  mediaType: "application/json",
  dependencies: {
    name: controller.fields.name,
    ingress: controller.fields.ingress,
    firmwareUpdate: controller.fields.firmwareUpdate,
    remoteDiagnostics: controller.fields.remoteDiagnostics,
  },
  render: input => JSON.stringify({
    subject: input.name,
    visibleLabels: [input.ingress],
    scenes: [
      "product hero on neutral background",
      ...(input.firmwareUpdate ? ["service engineer connects a USB-C cable for firmware maintenance"] : []),
      ...(input.remoteDiagnostics ? ["operator sees remote diagnostics on a laptop"] : []),
    ],
  }, null, 2),
});

export const schematic = artifact("artifact.schematic.service-interface", {
  kind: "schematic",
  path: "engineering/orbit/service-interface.mmd",
  mediaType: "text/vnd.mermaid",
  dependencies: {
    supply: controller.fields.supply,
    connector: servicePort.fields.connector,
    data: servicePort.fields.data,
  },
  render: ({ supply, connector, data }) => [
    "flowchart LR",
    `  PSU[${supply}] --> CTRL[Orbit controller]`,
    `  PORT[${connector.toUpperCase()} / ${data}] --> CTRL`,
  ].join("\n"),
});

export const firmwareConfig = artifact("artifact.firmware.capabilities", {
  kind: "firmware",
  path: "firmware/generated/product-capabilities.ts",
  mediaType: "text/typescript",
  dependencies: {
    firmwareUpdate: controller.fields.firmwareUpdate,
    remoteDiagnostics: controller.fields.remoteDiagnostics,
  },
  render: ({ firmwareUpdate, remoteDiagnostics }) => [
    "// Generated from the product model. Do not hand-edit.",
    `export const PRODUCT_CAPABILITIES = ${JSON.stringify({ firmwareUpdate, remoteDiagnostics })} as const;`,
  ].join("\n"),
});

export const apiCapabilities = artifact("artifact.code.api-capabilities", {
  kind: "code",
  path: "app/generated/orbit-capabilities.json",
  mediaType: "application/json",
  dependencies: {
    firmwareUpdate: controller.fields.firmwareUpdate,
    remoteDiagnostics: controller.fields.remoteDiagnostics,
    serviceData: servicePort.fields.data,
  },
  render: input => JSON.stringify(input, null, 2),
});

export const salesSpec = artifact("artifact.sales.spec", {
  kind: "sales",
  path: "sales/orbit-spec.md",
  mediaType: "text/markdown",
  dependencies: {
    name: controller.fields.name,
    supply: controller.fields.supply,
    ingress: controller.fields.ingress,
    firmwareUpdate: controller.fields.firmwareUpdate,
    remoteDiagnostics: controller.fields.remoteDiagnostics,
  },
  render: input => [
    `# ${input.name} — commercial specification`,
    `- Supply: ${input.supply}`,
    `- Enclosure: ${input.ingress}`,
    `- Firmware update: ${input.firmwareUpdate ? "yes" : "no"}`,
    `- Remote diagnostics: ${input.remoteDiagnostics ? "yes" : "no"}`,
  ].join("\n"),
});

export const supportRunbook = artifact("artifact.support.runbook", {
  kind: "support",
  path: "support/orbit.md",
  mediaType: "text/markdown",
  dependencies: {
    firmwareUpdate: controller.fields.firmwareUpdate,
    serviceData: servicePort.fields.data,
    remoteDiagnostics: controller.fields.remoteDiagnostics,
  },
  render: ({ firmwareUpdate, serviceData, remoteDiagnostics }) => [
    "# Orbit support runbook",
    remoteDiagnostics ? "1. Start with remote diagnostics." : "1. Collect symptoms manually.",
    firmwareUpdate && serviceData !== "none"
      ? "2. If required, update firmware through the service data port."
      : "2. Do not promise field firmware update through the service port.",
  ].join("\n"),
});

export const orbit = model({
  id: "orbit-product-thread",
  version: "0.1.0",
  entities: [controller, servicePort],
  values: [website, mediaBrief, schematic, firmwareConfig, apiCapabilities, salesSpec, supportRunbook],
  checks: [productConsistency],
});

export const baseline = orbit.scenario("revision-b")
  .set(controller.fields.name, assumption("Orbit Controller", "Fictional product name"))
  .set(controller.fields.supply, assumption("24VDC", "Fictional electrical design"))
  .set(controller.fields.ingress, assumption("IP54", "Fictional enclosure target"))
  .set(controller.fields.firmwareUpdate, assumption(true, "Fictional released capability"))
  .set(controller.fields.remoteDiagnostics, assumption(true, "Fictional released capability"))
  .set(servicePort.fields.connector, assumption("usb-c", "Fictional connector"))
  .set(servicePort.fields.data, assumption("usb2", "Fictional service protocol"))
  .set(servicePort.fields.powerDelivery, assumption(false, "Fictional power policy"));

export const noFieldUpdate = baseline
  .fork("revision-b-no-field-update")
  .set(controller.fields.firmwareUpdate, assumption(false, "What-if: remove field update capability"));

export const ruggedized = baseline
  .fork("revision-c-ruggedized")
  .set(controller.fields.ingress, assumption("IP65", "What-if: ruggedized enclosure"));

export const scenarios = [baseline, noFieldUpdate, ruggedized];
