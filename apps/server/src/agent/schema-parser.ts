export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export interface InferredSchema {
  type: JsonSchemaType | JsonSchemaType[];
  nullable?: boolean;
  properties?: Record<string, InferredSchema>;
  items?: InferredSchema;
  required?: string[];
}

export interface SchemaValidationResult {
  valid: boolean;
  value: unknown;
  errors: string[];
  missing: Array<{ field: string; missing_reason: string }>;
}

const NUMBERISH = /(percent|temperature|_c|_h|yield|time|count|mw|mass|equiv|eq\b)/i;

function inferFromExample(example: unknown, key = ""): InferredSchema {
  if (example === null) {
    return NUMBERISH.test(key) ? { type: ["number", "null"], nullable: true } : { type: ["string", "number", "null"], nullable: true };
  }
  if (typeof example === "string") {
    return { type: ["string", "null"], nullable: true };
  }
  if (typeof example === "number") {
    return Number.isInteger(example) ? { type: ["integer", "null"], nullable: true } : { type: ["number", "null"], nullable: true };
  }
  if (typeof example === "boolean") {
    return { type: ["boolean", "null"], nullable: true };
  }
  if (Array.isArray(example)) {
    const itemExample = example[0] ?? "";
    return { type: "array", items: inferFromExample(itemExample, key) };
  }
  if (typeof example === "object") {
    const properties: Record<string, InferredSchema> = {};
    for (const [childKey, childValue] of Object.entries(example as Record<string, unknown>)) {
      properties[childKey] = inferFromExample(childValue, childKey);
    }
    return { type: "object", properties, required: Object.keys(properties) };
  }
  return { type: ["string", "null"], nullable: true };
}

export function parseExampleToSchema(example: unknown): InferredSchema {
  return inferFromExample(example);
}

function typeAllows(schema: InferredSchema, value: unknown): boolean {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) return types.includes("null") || Boolean(schema.nullable);
  if (typeof value === "string") return types.includes("string");
  if (typeof value === "boolean") return types.includes("boolean");
  if (typeof value === "number") return types.includes("number") || types.includes("integer");
  if (Array.isArray(value)) return types.includes("array");
  if (typeof value === "object") return types.includes("object");
  return false;
}

function coerce(schema: InferredSchema, value: unknown): unknown {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === "" && (types.includes("null") || schema.nullable)) return null;
  if (value === "null") return null;
  if ((types.includes("number") || types.includes("integer")) && typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return types.includes("integer") ? Number.parseInt(value, 10) : Number(value);
  }
  return value;
}

export function validateAgainstSchema(schema: InferredSchema, raw: unknown, path = ""): SchemaValidationResult {
  const errors: string[] = [];
  const missing: Array<{ field: string; missing_reason: string }> = [];

  const walk = (node: InferredSchema, value: unknown, currentPath: string): unknown => {
    const coerced = coerce(node, value);
    if (!typeAllows(node, coerced)) {
      errors.push(`${currentPath || "$"} expected ${JSON.stringify(node.type)}, got ${JSON.stringify(coerced)}`);
      return null;
    }
    if (coerced === null) {
      if (currentPath) missing.push({ field: currentPath, missing_reason: "source_not_present" });
      return null;
    }
    if (node.type === "object" || (Array.isArray(node.type) && node.type.includes("object"))) {
      const input = (coerced ?? {}) as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        const childPath = currentPath ? `${currentPath}.${key}` : key;
        output[key] = walk(child, input[key], childPath);
      }
      return output;
    }
    if (node.type === "array") {
      const items = Array.isArray(coerced) ? coerced : [];
      return items.map((item, index) => walk(node.items ?? { type: ["string", "null"], nullable: true }, item, `${currentPath}[${index}]`));
    }
    return coerced;
  };

  const value = walk(schema, raw, path);
  return { valid: errors.length === 0, value, errors, missing };
}

export function projectToSchema(schema: InferredSchema, raw: unknown): unknown {
  return validateAgainstSchema(schema, raw).value;
}

export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  const slice = first >= 0 && last > first ? candidate.slice(first, last + 1) : candidate;
  return JSON.parse(slice);
}
