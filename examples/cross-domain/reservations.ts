import { artifact, assumption, derive, entity, model, rule, s } from "../../src/index.ts";
import { snapshot } from "./snapshots.ts";

// A workshop seat: advertising, search and booking consume the same slot identity.
// A feasible request does not mutate inventory or manufacture a confirmation.
const text = s.string({ minLength: 1 });
const integer = s.number({ integer: true, min: 0 });
const slotShape = { title: text, priceCents: integer };
const inventoryShape = { version: integer, remaining: integer, capturedAt: integer, expiresAt: integer };
const requestShape = { quantity: s.number({ integer: true, min: 1 }), now: integer };
const bookingShape = { confirmed: s.boolean, agreedCents: integer, reference: text };
export const slot = entity("booking.slot.workshop", { type: "scheduled-workshop", version: "1", fields: slotShape });
export const inventory = entity("booking.inventory.workshop", { type: "inventory-snapshot", version: "1", fields: inventoryShape });
export const request = entity("booking.request", { type: "seat-request", version: "1", fields: requestShape });
export const booking = entity("booking.accepted", { type: "reservation-record", version: "1", fields: bookingShape });
const fixture = snapshot(new URL("./fixtures/reservations.json", import.meta.url), s.object({
  slot: s.object(slotShape), inventory: s.object(inventoryShape), request: s.object(requestShape), booking: s.object(bookingShape),
}));
export const fresh = derive("booking.snapshot.fresh", s.boolean, {
  now: request.fields.now, captured: inventory.fields.capturedAt, expires: inventory.fields.expiresAt,
}, ({ now, captured, expires }) => captured <= now && now < expires);
export const bookable = derive("booking.request.feasible", s.boolean, {
  fresh, remaining: inventory.fields.remaining, requested: request.fields.quantity,
}, ({ fresh, remaining, requested }) => fresh && requested <= remaining);
export const listing = artifact("booking.surface.listing", {
  kind: "website", path: "booking/listing.json", mediaType: "application/json",
  dependencies: { title: slot.fields.title, priceCents: slot.fields.priceCents },
  render: values => JSON.stringify({ slot: slot.id, currency: "USD", ...values }),
});
export const searchResult = artifact("booking.surface.search", {
  kind: "data", path: "booking/search-result.json", mediaType: "application/json",
  dependencies: { feasible: bookable, fresh },
  render: ({ feasible, fresh }) => JSON.stringify({ slot: slot.id, availability: !fresh ? "unknown" : feasible ? "candidate" : "unavailable" }),
});
export const bookingIntent = artifact("booking.surface.intent", {
  kind: "code", path: "booking/reservation-request.json", mediaType: "application/json",
  dependencies: { feasible: bookable, expectedVersion: inventory.fields.version, quantity: request.fields.quantity },
  render: values => JSON.stringify({ slot: slot.id, ...values, action: "Ask inventory authority; never confirm locally" }),
});
export const confirmation = artifact("booking.surface.confirmation", {
  kind: "document", path: "booking/confirmation.json", mediaType: "application/json",
  dependencies: { confirmed: booking.fields.confirmed, agreedCents: booking.fields.agreedCents, reference: booking.fields.reference },
  render: values => JSON.stringify({ slot: slot.id, ...values }),
});
export const business = model({ id: "reservations-thread", version: "1", entities: [slot, inventory, request, booking],
  values: [listing, searchResult, bookingIntent, confirmation], checks: [rule("booking.fresh-inventory-required", { fresh },
    ({ fresh }) => fresh, "Do not use an expired availability snapshot to accept a reservation")] });
const { data: d, input } = fixture;
export const baseline = business.scenario("last-seat")
  .set(slot.fields.title, input(d.slot.title, "event-catalog"))
  .set(slot.fields.priceCents, input(d.slot.priceCents, "event-catalog"))
  .set(inventory.fields.version, input(d.inventory.version, "inventory-authority"))
  .set(inventory.fields.remaining, input(d.inventory.remaining, "inventory-authority"))
  .set(inventory.fields.capturedAt, input(d.inventory.capturedAt, "inventory-authority"))
  .set(inventory.fields.expiresAt, input(d.inventory.expiresAt, "inventory-authority"))
  .set(request.fields.quantity, input(d.request.quantity, "request"))
  .set(request.fields.now, input(d.request.now, "explicit-evaluation-time"))
  .set(booking.fields.confirmed, input(d.booking.confirmed, "booking-authority"))
  .set(booking.fields.agreedCents, input(d.booking.agreedCents, "booking-authority"))
  .set(booking.fields.reference, input(d.booking.reference, "booking-authority"));
export const expired = baseline.fork("cache-expired")
  .set(request.fields.now, assumption(d.inventory.expiresAt, "Availability cache expired"));
export const soldOut = baseline.fork("inventory-updated")
  .set(inventory.fields.remaining, assumption(0, "Another buyer reserved the last seat"))
  .set(inventory.fields.version, assumption(8, "Next authoritative revision"));
export const surfaces = [listing, searchResult, bookingIntent, confirmation];
export const scenarios = [baseline, expired, soldOut];
