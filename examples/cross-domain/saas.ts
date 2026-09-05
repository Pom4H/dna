import { artifact, assumption, derive, entity, model, rule, s } from "../../src/index.ts";
import { snapshot } from "./snapshots.ts";

// A public offer is NOT an existing customer's accepted agreement.
const offerShape = { monthlyCents: s.number({ integer: true, min: 0 }), seats: s.number({ integer: true, min: 1 }) };
const agreementShape = { monthlyCents: offerShape.monthlyCents, seats: offerShape.seats,
  tenant: s.string({ minLength: 1 }), active: s.boolean };
const requestShape = { tenant: s.string({ minLength: 1 }), role: s.enum("owner", "viewer"),
  occupiedSeats: s.number({ integer: true, min: 0 }), privateEmail: s.string() };
export const offer = entity("saas.offer.team", { type: "subscription-offer", version: "1", fields: offerShape });
export const agreement = entity("saas.agreement.customer", { type: "accepted-subscription", version: "1", fields: agreementShape });
export const request = entity("saas.request.invite", { type: "authenticated-request-snapshot", version: "1", fields: requestShape });
const fixture = snapshot(new URL("./fixtures/saas.json", import.meta.url), s.object({
  offer: s.object(offerShape), agreement: s.object(agreementShape), request: s.object(requestShape),
}));
export const canInvite = derive("saas.invite.allowed", s.boolean, {
  active: agreement.fields.active, entitledSeats: agreement.fields.seats,
  tenant: agreement.fields.tenant, actorTenant: request.fields.tenant,
  role: request.fields.role, occupied: request.fields.occupiedSeats,
}, ({ active, entitledSeats, tenant, actorTenant, role, occupied }) =>
  active && tenant === actorTenant && role === "owner" && occupied < entitledSeats);
export const pricing = artifact("saas.surface.pricing", {
  kind: "website", path: "saas/pricing.json", mediaType: "application/json",
  dependencies: { monthlyCents: offer.fields.monthlyCents, seats: offer.fields.seats },
  render: values => JSON.stringify({ currency: "USD", period: "month", ...values }),
});
export const billing = artifact("saas.surface.billing", {
  kind: "data", path: "saas/billing-line.json", mediaType: "application/json",
  dependencies: { monthlyCents: agreement.fields.monthlyCents },
  render: ({ monthlyCents }) => JSON.stringify({ currency: "USD", amountCents: monthlyCents }),
});
export const api = artifact("saas.surface.api", {
  kind: "code", path: "saas/invite-decision.json", mediaType: "application/json",
  dependencies: { allowed: canInvite }, render: values => JSON.stringify(values),
});
export const support = artifact("saas.surface.support", {
  kind: "support", path: "saas/support.md", mediaType: "text/markdown",
  dependencies: { allowed: canInvite, seats: agreement.fields.seats },
  render: ({ allowed, seats }) => `Contracted seats: ${seats}. ${allowed ? "Invite permitted in this snapshot." : "Check account, role, tenant and remaining seats."}`,
});
export const business = model({ id: "saas-thread", version: "1", entities: [offer, agreement, request],
  values: [pricing, billing, api, support], checks: [rule("saas.valid-seat-snapshot", {
    occupied: request.fields.occupiedSeats, seats: agreement.fields.seats,
  }, ({ occupied, seats }) => occupied <= seats)] });
const { data: d, input } = fixture;
export const baseline = business.scenario("accepted-old-offer")
  .set(offer.fields.monthlyCents, input(d.offer.monthlyCents, "catalog"))
  .set(offer.fields.seats, input(d.offer.seats, "catalog"))
  .set(agreement.fields.monthlyCents, input(d.agreement.monthlyCents, "billing-agreement"))
  .set(agreement.fields.seats, input(d.agreement.seats, "billing-agreement"))
  .set(agreement.fields.tenant, input(d.agreement.tenant, "billing-agreement"))
  .set(agreement.fields.active, input(d.agreement.active, "billing-agreement"))
  .set(request.fields.tenant, input(d.request.tenant, "identity"))
  .set(request.fields.role, input(d.request.role, "identity"))
  .set(request.fields.occupiedSeats, input(d.request.occupiedSeats, "usage"))
  .set(request.fields.privateEmail, input(d.request.privateEmail, "identity"));
export const repriced = baseline.fork("new-offer-only")
  .set(offer.fields.monthlyCents, assumption(4_900, "What-if catalog changes, not a signed agreement"))
  .set(offer.fields.seats, assumption(2, "What-if the new offer is smaller"));
export const outsider = baseline.fork("different-tenant")
  .set(request.fields.tenant, assumption("tenant.other", "What-if cross-tenant request"));
export const surfaces = [pricing, billing, api, support];
export const scenarios = [baseline, repriced, outsider];
