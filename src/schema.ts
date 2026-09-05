/** A deliberately small JSON-shaped schema layer. No implicit coercion or defaults. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type JsonObject = { readonly [key: string]: Json };

export class ValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ValidationError";
  }
}

export interface Schema<T> {
  readonly json: JsonObject;
  parse(value: unknown, path?: string): T;
}
export type Infer<S> = S extends Schema<infer T> ? T : never;
export type Shape = Readonly<Record<string, Schema<unknown>>>;
export type ObjectValue<S extends Shape> = { readonly [K in keyof S]: Infer<S[K]> };

export function nonempty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(label, "must be a non-empty string");
  }
  return value;
}

function schema<T>(json: JsonObject, parse: (value: unknown, path: string) => T): Schema<T> {
  return Object.freeze({ json: Object.freeze(json), parse: (value: unknown, path = "$input") => parse(value, path) });
}
function fail(path: string, message: string): never { throw new ValidationError(path, message); }

export const s = {
  string(options: { minLength?: number; maxLength?: number } = {}): Schema<string> {
    const { minLength = 0, maxLength } = options;
    if (!Number.isSafeInteger(minLength) || minLength < 0 ||
      (maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < minLength))) {
      throw new ValidationError("string", "invalid length bounds");
    }
    return schema({ type: "string", minLength, ...(maxLength === undefined ? {} : { maxLength }) }, (value, path) => {
      if (typeof value !== "string") return fail(path, "expected string");
      if (value.length < minLength || (maxLength !== undefined && value.length > maxLength)) return fail(path, "length outside bounds");
      return value;
    });
  },
  boolean: schema<boolean>({ type: "boolean" }, (value, path) =>
    typeof value === "boolean" ? value : fail(path, "expected boolean")),
  number(options: { min?: number; max?: number; integer?: boolean } = {}): Schema<number> {
    const { min, max, integer = false } = options;
    if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max)) ||
      (min !== undefined && max !== undefined && min > max)) throw new ValidationError("number", "invalid bounds");
    return schema({ type: integer ? "integer" : "number", ...(min === undefined ? {} : { minimum: min }),
      ...(max === undefined ? {} : { maximum: max }) }, (value, path) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail(path, "expected finite number");
      if (integer && !Number.isSafeInteger(value)) return fail(path, "expected safe integer");
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) return fail(path, "number outside bounds");
      return Object.is(value, -0) ? 0 : value;
    });
  },
  enum<const T extends readonly [string, ...string[]]>(...values: T): Schema<T[number]> {
    if (new Set(values).size !== values.length) throw new ValidationError("enum", "duplicate alternatives");
    return schema({ type: "string", enum: Object.freeze([...values]) }, (value, path) =>
      typeof value === "string" && values.includes(value) ? value as T[number] : fail(path, `expected one of ${values.join(", ")}`));
  },
  array<T>(item: Schema<T>, options: { minLength?: number; maxLength?: number } = {}): Schema<readonly T[]> {
    const { minLength = 0, maxLength } = options;
    if (!Number.isSafeInteger(minLength) || minLength < 0 ||
      (maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < minLength))) {
      throw new ValidationError("array", "invalid length bounds");
    }
    return schema({ type: "array", items: item.json, minItems: minLength,
      ...(maxLength === undefined ? {} : { maxItems: maxLength }) }, (value, path) => {
      if (!Array.isArray(value)) return fail(path, "expected array");
      if (value.length < minLength || (maxLength !== undefined && value.length > maxLength)) return fail(path, "length outside bounds");
      // Array.from also validates holes; Array.map would silently preserve them.
      return Object.freeze(Array.from(value, (entry, index) => item.parse(entry, `${path}[${index}]`)));
    });
  },
  object<const S extends Shape>(shape: S): Schema<ObjectValue<S>> {
    const fields = Object.freeze({ ...shape });
    const keys = Object.keys(fields).sort();
    return schema({ type: "object", properties: Object.freeze(Object.fromEntries(keys.map(key => [key, fields[key]!.json]))),
      required: Object.freeze(keys), additionalProperties: false }, (value, path) => {
      if (value === null || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(path, "expected plain object");
      const input = value as Record<string, unknown>;
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || !Object.hasOwn(fields, key)) return fail(path, `unexpected property ${String(key)}`);
      }
      const output = Object.fromEntries(keys.map(key => [key, fields[key]!.parse(Object.hasOwn(input, key) ? input[key] : undefined, `${path}.${key}`)]));
      return Object.freeze(output) as ObjectValue<S>;
    });
  },
};
