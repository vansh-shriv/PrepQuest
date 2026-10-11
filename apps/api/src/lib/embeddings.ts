// Local, deterministic text embeddings (feature hashing) for resume retrieval. The product's
// retrieval needs are small (a handful of chunks per resume), and Anthropic offers no embedding
// model, so this keeps the pgvector path working with no extra provider. Swap `embedText` for a
// hosted model later; the column is vector(1024) either way.

export const EMBEDDING_DIMS = 1024;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "was",
  "i",
  "we",
  "my",
  "it",
  "at",
  "by",
  "as",
  "that",
  "this",
]);

export function embedText(text: string): number[] {
  const toks = (text.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) ?? []).filter((t) => !STOP.has(t));
  const v = new Array<number>(EMBEDDING_DIMS).fill(0);
  const add = (feature: string, weight: number) => {
    const h = fnv1a(feature);
    v[h % EMBEDDING_DIMS] = (v[h % EMBEDDING_DIMS] ?? 0) + (h & 0x80000000 ? -weight : weight);
  };
  toks.forEach((t, i) => {
    add(t, 1);
    const next = toks[i + 1];
    if (next) add(`${t} ${next}`, 0.5);
  });
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
