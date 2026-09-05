// Compiler-only negative tests. Never execute this function.
import { assumption, derive, entity, fact, model, rule, s } from "../src/index.ts";
export function assertTypeContracts(): void {
  const count = fact("count", s.number({ integer: true }));
  const active = fact("active", s.boolean);
  const member = entity("member", { type: "user", version: "1", fields: { role: s.enum("operator", "service") } });
  const doubled = derive("doubled", s.number(), { count }, ({ count }) => count * 2);
  const check = rule("check", { count, active }, ({ count, active }) => active && count > 0);
  const scenario = model({ id: "types", version: "1", values: [doubled], entities: [member], checks: [check] }).scenario("types");
  scenario.set(count, assumption(1, "Valid number"));
  scenario.set(member.fields.role, assumption("service", "Literal inference"));
  scenario.batch(draft => {
    draft.set(count, assumption(2, "Valid batch"));
    draft.record(member.fields.role, assumption("operator", "Literal batch"));
    // @ts-expect-error batch must preserve NoInfer and reject strings for numbers
    draft.set(count, assumption("2", "Wrong type"));
    // @ts-expect-error enum alternatives remain literal inside batch
    draft.record(member.fields.role, assumption("owner", "Wrong role"));
    // @ts-expect-error computed definitions are not writable
    draft.set(doubled, assumption(2, "Not a fact"));
  });
  // @ts-expect-error batches are synchronous, never async callbacks
  scenario.batch(async () => {});
  // @ts-expect-error a number fact rejects strings; set must not infer a wider union
  scenario.set(count, assumption("1", "Wrong type"));
  // @ts-expect-error booleans do not accept truthy strings
  scenario.set(active, assumption("yes", "Wrong type"));
  // @ts-expect-error enum alternatives are preserved across entity inference
  scenario.set(member.fields.role, assumption("owner", "Unsupported role"));
  // @ts-expect-error computed values cannot be overwritten with scenario assumptions
  scenario.set(doubled, assumption(9, "Cannot bypass derivation"));
  // @ts-expect-error output must match the runtime schema
  derive("bad", s.boolean, { count }, ({ count }) => count + 1);
  // @ts-expect-error declared dependency inputs have actual inferred types
  rule("bad-count", { count }, ({ count }) => count.startsWith("1"));
  // @ts-expect-error callbacks are synchronous
  rule("async", { count }, async ({ count }) => count > 0);
  const result = scenario.read(count);
  // @ts-expect-error unknown/conflict/error values must be narrowed before use
  result.value.toFixed();
  if (result.status === "known") result.value.toFixed();
}
