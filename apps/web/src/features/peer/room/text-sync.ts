import type * as Y from "yjs";

// Keeps one text field (the Monaco model, or a plain textarea when the editor cannot load) and a shared
// Yjs text in step. The field owns what the person types; the shared text follows by a small diff, and
// edits from the partner are applied to the field as precise edits so the caret stays where it was.

export interface TextEdit {
  /** Offset in the text as it was before any of the edits in the same batch. */
  index: number;
  remove: number;
  insert: string;
}

/** The smallest single edit that turns `before` into `after`, or null when they are equal. */
export function diffEdit(before: string, after: string): TextEdit | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore--;
    endAfter--;
  }
  return { index: start, remove: endBefore - start, insert: after.slice(start, endAfter) };
}

interface DeltaOp {
  retain?: number;
  insert?: string | object;
  delete?: number;
}

/** Turns a Yjs text delta into edits in the coordinates of the text before the change. */
export function deltaToEdits(delta: readonly DeltaOp[]): TextEdit[] {
  const edits: TextEdit[] = [];
  let pos = 0;
  for (const op of delta) {
    if (op.retain !== undefined) pos += op.retain;
    else if (op.delete !== undefined) {
      const last = edits[edits.length - 1];
      // an insert right before a delete at the same place is one replacement
      if (last && last.index + last.remove === pos && last.insert.length > 0 && last.remove === 0)
        last.remove = op.delete;
      else edits.push({ index: pos, remove: op.delete, insert: "" });
      pos += op.delete;
    } else if (typeof op.insert === "string") {
      edits.push({ index: pos, remove: 0, insert: op.insert });
    }
  }
  return edits;
}

/** Applies edits given in the coordinates of `text` (as Monaco does with a batch). */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  let out = "";
  let at = 0;
  for (const e of [...edits].sort((a, b) => a.index - b.index)) {
    out += text.slice(at, e.index) + e.insert;
    at = e.index + e.remove;
  }
  return out + text.slice(at);
}

/** Where a caret at `offset` ends up after the edits (a caret inside a removed span goes to its start). */
export function moveOffset(offset: number, edits: readonly TextEdit[]): number {
  let shift = 0;
  for (const e of [...edits].sort((a, b) => a.index - b.index)) {
    if (e.index >= offset) break;
    if (e.index + e.remove <= offset) shift += e.insert.length - e.remove;
    else return e.index + shift + e.insert.length;
  }
  return offset + shift;
}

export interface TextField {
  value(): string;
  /** Applies a batch of edits (original coordinates) without telling `onChange`. */
  replace(edits: TextEdit[]): void;
  onChange(cb: () => void): () => void;
}

export const BINDING_ORIGIN = Symbol("text-binding");

/** Binds the field to the shared text. Returns a function that undoes the binding. */
export function bindText(ytext: Y.Text, field: TextField): () => void {
  let applying = false;
  const sync = (edits: TextEdit[]) => {
    applying = true;
    try {
      field.replace(edits);
    } finally {
      applying = false;
    }
  };
  const shared = ytext.toString();
  if (field.value() !== shared) sync([{ index: 0, remove: field.value().length, insert: shared }]);

  const observer = (event: Y.YTextEvent, tr: Y.Transaction) => {
    if (tr.origin === BINDING_ORIGIN) return;
    sync(deltaToEdits(event.delta as DeltaOp[]));
  };
  ytext.observe(observer);

  const off = field.onChange(() => {
    if (applying) return;
    const edit = diffEdit(ytext.toString(), field.value());
    if (!edit) return;
    ytext.doc?.transact(() => {
      if (edit.remove > 0) ytext.delete(edit.index, edit.remove);
      if (edit.insert) ytext.insert(edit.index, edit.insert);
    }, BINDING_ORIGIN);
  });
  return () => {
    ytext.unobserve(observer);
    off();
  };
}
