import { artifact, assumption, derive, entity, model, rule, s } from "../../src/index.ts";
import { snapshot } from "./snapshots.ts";

// Fictional editorial distribution policy, NOT an interpretation of copyright law.
const text = s.string({ minLength: 1 });
const instant = s.number({ integer: true, min: 0 });
const assetShape = { uri: text, revision: text };
const grantShape = { assetRevision: text, markets: s.array(s.enum("NL", "DE")),
  channels: s.array(s.enum("web", "social")), startsAt: instant, endsAt: instant, revoked: s.boolean };
export const asset = entity("publishing.asset.campaign", { type: "media-asset", version: "1", fields: assetShape });
export const grant = entity("publishing.grant.campaign", { type: "distribution-permission", version: "1", fields: grantShape });
export const context = entity("publishing.context", { type: "distribution-request", version: "1", fields: { market: s.enum("NL", "DE"), now: instant } });
const fixture = snapshot(new URL("./fixtures/publishing.json", import.meta.url), s.object({
  asset: s.object(assetShape), grant: s.object(grantShape), context: s.object({ market: s.enum("NL", "DE"), now: instant }),
}));
const dependencies = {
  revision: asset.fields.revision, grantedRevision: grant.fields.assetRevision,
  markets: grant.fields.markets, channels: grant.fields.channels,
  startsAt: grant.fields.startsAt, endsAt: grant.fields.endsAt, revoked: grant.fields.revoked,
  market: context.fields.market, now: context.fields.now,
};
// The channel is a fixed policy parameter, not hidden changing state.
function permission(channel: "web" | "social") {
  return derive(`publishing.permission.${channel}`, s.boolean, dependencies,
    ({ revision, grantedRevision, markets, channels, startsAt, endsAt, revoked, market, now }) =>
      !revoked && revision === grantedRevision && markets.includes(market) && channels.includes(channel)
      && now >= startsAt && now < endsAt);
}
export const webAllowed = permission("web");
export const socialAllowed = permission("social");
export const website = artifact("publishing.surface.website", {
  kind: "website", path: "publishing/web-placement.json", mediaType: "application/json",
  dependencies: { allowed: webAllowed, uri: asset.fields.uri },
  render: ({ allowed, uri }) => JSON.stringify({ publish: allowed, ...(allowed ? { uri } : {}) }),
});
export const campaign = artifact("publishing.surface.campaign", {
  kind: "media", path: "publishing/social-placement.json", mediaType: "application/json",
  dependencies: { allowed: socialAllowed, uri: asset.fields.uri },
  render: ({ allowed, uri }) => JSON.stringify({ publish: allowed, ...(allowed ? { uri } : {}) }),
});
export const archive = artifact("publishing.surface.archive", {
  kind: "data", path: "publishing/archive-reference.json", mediaType: "application/json",
  dependencies: { uri: asset.fields.uri, revision: asset.fields.revision }, render: values => JSON.stringify(values),
});
export const runbook = artifact("publishing.surface.runbook", {
  kind: "support", path: "publishing/distribution.md", mediaType: "text/markdown",
  dependencies: { web: webAllowed, social: socialAllowed, market: context.fields.market },
  render: ({ web, social, market }) => `Market ${market}: web ${web ? "allowed" : "blocked"}; social ${social ? "allowed" : "blocked"}. Recheck permission at distribution time.`,
});
export const business = model({ id: "publishing-thread", version: "1", entities: [asset, grant, context],
  values: [website, campaign, archive, runbook], checks: [rule("publishing.valid-permission-window", {
    from: grant.fields.startsAt, to: grant.fields.endsAt,
  }, ({ from, to }) => from < to)] });
const { data: d, input } = fixture;
export const baseline = business.scenario("web-only-in-one-market")
  .set(asset.fields.uri, input(d.asset.uri, "asset-library"))
  .set(asset.fields.revision, input(d.asset.revision, "asset-library"))
  .set(grant.fields.assetRevision, input(d.grant.assetRevision, "permission-register"))
  .set(grant.fields.markets, input(d.grant.markets, "permission-register"))
  .set(grant.fields.channels, input(d.grant.channels, "permission-register"))
  .set(grant.fields.startsAt, input(d.grant.startsAt, "permission-register"))
  .set(grant.fields.endsAt, input(d.grant.endsAt, "permission-register"))
  .set(grant.fields.revoked, input(d.grant.revoked, "permission-register"))
  .set(context.fields.market, input(d.context.market, "distribution-request"))
  .set(context.fields.now, input(d.context.now, "explicit-evaluation-time"));
export const expired = baseline.fork("at-expiry")
  .set(context.fields.now, assumption(d.grant.endsAt, "Half-open validity interval"));
export const revoked = baseline.fork("revoked-without-deleting-asset")
  .set(grant.fields.revoked, assumption(true, "Withdrawal in the permission register"));
export const differentMarket = baseline.fork("unlicensed-market")
  .set(context.fields.market, assumption("DE", "Different distribution market"));
export const surfaces = [website, campaign, archive, runbook];
export const scenarios = [baseline, expired, revoked, differentMarket];
