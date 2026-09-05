import { artifact, assumption, derive, entity, model, rule, s } from "../../src/index.ts";
import { snapshot } from "./snapshots.ts";

// Productized professional service: offer -> proposal, accepted scope -> work order/invoice.
const scope = s.array(s.string({ minLength: 1 }), { minLength: 1 });
const money = s.number({ integer: true, min: 0 });
const hours = s.number({ min: 0 });
const offerShape = { deliverables: scope, feeCents: money };
const engagementShape = { deliverables: scope, feeCents: money, requiredHours: hours,
  inputsReady: s.boolean, milestoneAccepted: s.boolean };
export const offer = entity("service.offer.audit", { type: "service-offer", version: "1", fields: offerShape });
export const engagement = entity("service.engagement.accepted", { type: "accepted-engagement", version: "1", fields: engagementShape });
export const staffing = entity("service.staffing.week", { type: "capacity-snapshot", version: "1", fields: { freeHours: hours } });
const fixture = snapshot(new URL("./fixtures/services.json", import.meta.url), s.object({
  offer: s.object(offerShape), engagement: s.object(engagementShape), freeHours: hours,
}));
export const canSchedule = derive("service.schedule.feasible", s.boolean, {
  free: staffing.fields.freeHours, required: engagement.fields.requiredHours, ready: engagement.fields.inputsReady,
}, ({ free, required, ready }) => ready && free >= required);
export const website = artifact("service.surface.website", {
  kind: "website", path: "services/offer.json", mediaType: "application/json",
  dependencies: { deliverables: offer.fields.deliverables, feeCents: offer.fields.feeCents },
  render: values => JSON.stringify({ currency: "USD", ...values }),
});
export const proposal = artifact("service.surface.proposal", {
  kind: "sales", path: "services/proposal.json", mediaType: "application/json",
  dependencies: { deliverables: offer.fields.deliverables, feeCents: offer.fields.feeCents },
  render: values => JSON.stringify({ ...values, deliveryDate: "Requires a separate capacity commitment" }),
});
export const workOrder = artifact("service.surface.work-order", {
  kind: "document", path: "services/accepted-work-order.json", mediaType: "application/json",
  dependencies: { deliverables: engagement.fields.deliverables, hours: engagement.fields.requiredHours },
  render: values => JSON.stringify(values),
});
export const schedule = artifact("service.surface.schedule", {
  kind: "data", path: "services/schedule-check.json", mediaType: "application/json",
  dependencies: { feasible: canSchedule }, render: values => JSON.stringify(values),
});
export const invoice = artifact("service.surface.invoice", {
  kind: "data", path: "services/invoice-candidate.json", mediaType: "application/json",
  dependencies: { accepted: engagement.fields.milestoneAccepted, feeCents: engagement.fields.feeCents },
  render: ({ accepted, feeCents }) => JSON.stringify({ currency: "USD", billableCents: accepted ? feeCents : 0 }),
});
export const business = model({ id: "service-thread", version: "1", entities: [offer, engagement, staffing],
  values: [website, proposal, workOrder, schedule, invoice], checks: [rule("service.delivery-feasible", { feasible: canSchedule },
    ({ feasible }) => feasible, "This snapshot can cover the accepted effort; not a capacity reservation")] });
const { data: d, input } = fixture;
export const baseline = business.scenario("accepted-engagement")
  .set(offer.fields.deliverables, input(d.offer.deliverables, "offer-catalog"))
  .set(offer.fields.feeCents, input(d.offer.feeCents, "offer-catalog"))
  .set(engagement.fields.deliverables, input(d.engagement.deliverables, "accepted-scope"))
  .set(engagement.fields.feeCents, input(d.engagement.feeCents, "accepted-scope"))
  .set(engagement.fields.requiredHours, input(d.engagement.requiredHours, "estimate"))
  .set(engagement.fields.inputsReady, input(d.engagement.inputsReady, "delivery-tracker"))
  .set(engagement.fields.milestoneAccepted, input(d.engagement.milestoneAccepted, "acceptance-record"))
  .set(staffing.fields.freeHours, input(d.freeHours, "staffing-calendar"));
export const expandedOffer = baseline.fork("expanded-offer-not-old-scope")
  .set(offer.fields.deliverables, assumption(["Review", "Workshop", "Implementation"], "New catalog scope"))
  .set(offer.fields.feeCents, assumption(240_000, "New catalog price"));
export const overloaded = baseline.fork("overcommitted")
  .set(staffing.fields.freeHours, assumption(4, "Another engagement consumes capacity"));
export const accepted = baseline.fork("milestone-accepted")
  .set(engagement.fields.milestoneAccepted, assumption(true, "Synthetic customer acceptance"));
export const surfaces = [website, proposal, workOrder, schedule, invoice];
export const scenarios = [baseline, expandedOffer, overloaded, accepted];
