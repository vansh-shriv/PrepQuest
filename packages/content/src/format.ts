import type { Example, Signature } from "./types.js";

/** Human-readable value for the statement page, e.g. `[2, 7, 11]`, `"abc"`, `true`. */
export function showValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(showValue).join(", ")}]`;
  return String(value);
}

/** Turns a structured example into the `{input, output, explanation}` the UI displays. */
export function formatExample(signature: Signature, example: Example) {
  const input = signature.params
    .map((p, i) => `${p.name} = ${showValue(example.args[i])}`)
    .join("\n");
  return {
    input,
    output: showValue(example.expected),
    ...(example.explanation ? { explanation: example.explanation } : {}),
  };
}
