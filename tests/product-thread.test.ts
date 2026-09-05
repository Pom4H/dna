import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiCapabilities,
  baseline,
  controller,
  firmwareConfig,
  mediaBrief,
  noFieldUpdate,
  orbit,
  ruggedized,
  salesSpec,
  schematic,
  servicePort,
  supportRunbook,
  website,
} from "../examples/product-thread.ts";

function content(scenario: typeof baseline, artifact: typeof website): string {
  const result = scenario.read(artifact);
  assert.equal(result.status, "known");
  return result.status === "known" ? result.value.content : "";
}

test("one product capability is projected into website, media, firmware, app, sales and support", () => {
  assert.match(content(baseline, website), /Firmware can be updated/);
  assert.match(content(baseline, mediaBrief), /USB-C cable for firmware maintenance/);
  assert.match(content(baseline, firmwareConfig), /"firmwareUpdate":true/);
  assert.match(content(baseline, apiCapabilities), /"firmwareUpdate": true/);
  assert.match(content(baseline, salesSpec), /Firmware update: yes/);
  assert.match(content(baseline, supportRunbook), /update firmware through the service data port/);
});

test("removing one capability changes every representation that depends on it, but not unrelated engineering artifacts", () => {
  assert.match(content(noFieldUpdate, website), /not offered as a product capability/);
  assert.doesNotMatch(content(noFieldUpdate, mediaBrief), /firmware maintenance/);
  assert.match(content(noFieldUpdate, firmwareConfig), /"firmwareUpdate":false/);
  assert.match(content(noFieldUpdate, apiCapabilities), /"firmwareUpdate": false/);
  assert.match(content(noFieldUpdate, salesSpec), /Firmware update: no/);
  assert.match(content(noFieldUpdate, supportRunbook), /Do not promise field firmware update/);

  assert.equal(content(noFieldUpdate, schematic), content(baseline, schematic));
});

test("an enclosure change reaches website, media and sales but does not rewrite firmware or API capabilities", () => {
  assert.match(content(ruggedized, website), /IP65/);
  assert.match(content(ruggedized, mediaBrief), /IP65/);
  assert.match(content(ruggedized, salesSpec), /IP65/);

  assert.equal(content(ruggedized, firmwareConfig), content(baseline, firmwareConfig));
  assert.equal(content(ruggedized, apiCapabilities), content(baseline, apiCapabilities));
  assert.equal(content(ruggedized, supportRunbook), content(baseline, supportRunbook));
});

test("impact graph exposes which business artifacts must be reconsidered before materialization", () => {
  assert.deepEqual(orbit.impact(controller.fields.firmwareUpdate), [
    "artifact.code.api-capabilities",
    "artifact.firmware.capabilities",
    "artifact.media.product-brief",
    "artifact.sales.spec",
    "artifact.support.runbook",
    "artifact.website.product-page",
    "product.orbit.firmware-requires-data-port",
  ]);

  assert.deepEqual(orbit.impact(controller.fields.ingress), [
    "artifact.media.product-brief",
    "artifact.sales.spec",
    "artifact.website.product-page",
  ]);

  assert.deepEqual(orbit.impact(servicePort.fields.data), [
    "artifact.code.api-capabilities",
    "artifact.schematic.service-interface",
    "artifact.support.runbook",
    "product.orbit.firmware-requires-data-port",
  ]);
});

test("product rule prevents marketing/code projections from legitimizing an impossible hardware claim", () => {
  const impossible = baseline
    .fork("broken-service-port")
    .set(servicePort.fields.data, { value: "none", provenance: { kind: "assumption", reason: "What-if broken design" } });

  const report = impossible.evaluate();
  const check = report.checks.find(entry => entry.id === "product.orbit.firmware-requires-data-port");
  assert.equal(check?.status, "fail");
});
