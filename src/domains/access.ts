import { entity } from "../definitions.ts";
import { s } from "../schema.ts";

/** Identity in an authorization context; not a universal CRM/customer/person object. */
export function user(id: string) {
  return entity(id, { type: "access.user", version: "0.1.0", fields: {
    active: s.boolean,
    role: s.enum("operator", "service", "admin"),
    tenant: s.string({ minLength: 1 }),
  } });
}
