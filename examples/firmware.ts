import { assumption, derive, entity, fact, model, rule, s } from "../src/index.ts";
import { user } from "../src/domains/access.ts";
import { usbCPort } from "../src/domains/usb.ts";

export const actor = user("example.engineer");
export const port = usbCPort("example.controller.rev-b.service");
export const controller = entity("example.controller.rev-b", { type: "product.device", version: "0.1.0", fields: {
  tenant: s.string({ minLength: 1 }),
  mode: s.enum("operating", "maintenance"),
  firmwareUpdate: s.boolean,
} });
export const requested = fact("example.firmware.update-requested", s.boolean);

export const allowed = derive("example.firmware.allowed", s.boolean, {
  active: actor.fields.active, role: actor.fields.role, actorTenant: actor.fields.tenant,
  deviceTenant: controller.fields.tenant, mode: controller.fields.mode,
  firmwareUpdate: controller.fields.firmwareUpdate, data: port.fields.data,
}, ({ active, role, actorTenant, deviceTenant, mode, firmwareUpdate, data }) => {
  if (!active || actorTenant !== deviceTenant) return false;
  if (role !== "service" && role !== "admin") return false;
  if (mode !== "maintenance" || !firmwareUpdate) return false;
  return data !== "none";
}, { description: "Illustrative product policy, not a real device command or complete security policy" });

export const authorization = rule("example.firmware.authorization", { requested, allowed },
  ({ requested, allowed }) => !requested || allowed,
  "An update request must satisfy all modeled authorization and device prerequisites");
export const dna = model({ id: "firmware-example", version: "0.1.0", entities: [actor, port, controller],
  checks: [authorization] });
export const baseline = dna.scenario("service-engineer")
  .set(actor.fields.active, assumption(true, "Synthetic user fixture"))
  .set(actor.fields.role, assumption("service", "Synthetic service role"))
  .set(actor.fields.tenant, assumption("tenant-a", "Synthetic organization"))
  .set(controller.fields.tenant, assumption("tenant-a", "Synthetic device ownership"))
  .set(controller.fields.mode, assumption("maintenance", "Simulated maintenance mode"))
  .set(controller.fields.firmwareUpdate, assumption(true, "Feature explicitly declared; not inferred from USB-C"))
  .set(port.fields.data, assumption("usb2", "Explicit protocol assumption"))
  .set(port.fields.powerDelivery, assumption(false, "Connector shape does not imply Power Delivery"))
  .set(requested, assumption(true, "Simulated update request"));
export const operator = baseline.fork("operator-denied").set(actor.fields.role, assumption("operator", "Negative authorization case"));
export const noData = baseline.fork("charge-only-port").set(port.fields.data, assumption("none", "Same connector, no data"));
export const scenarios = [baseline];
