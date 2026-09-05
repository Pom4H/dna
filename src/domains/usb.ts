import { entity } from "../definitions.ts";
import { s } from "../schema.ts";

/** An illustrative vocabulary, NOT USB-IF compliance or electrical validation. */
export function usbCPort(id: string) {
  return entity(id, { type: "usb.type-c.port", version: "0.1.0", fields: {
    data: s.enum("none", "usb2", "usb3", "usb4"),
    powerDelivery: s.boolean,
  } });
}
