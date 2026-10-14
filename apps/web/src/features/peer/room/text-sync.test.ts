import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyTextEdits,
  bindText,
  deltaToEdits,
  diffEdit,
  moveOffset,
  type TextEdit,
  type TextField,
} from "./text-sync";

/** A text field held in memory, like a textarea. */
function fakeField(initial = ""): TextField & { type(edit: TextEdit): void; text: string } {
  const listeners = new Set<() => void>();
  const f = {
    text: initial,
    value: () => f.text,
    replace(edits: TextEdit[]) {
      f.text = applyTextEdits(f.text, edits);
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    type(edit: TextEdit) {
      f.text = applyTextEdits(f.text, [edit]);
      listeners.forEach((cb) => cb());
    },
  };
  return f;
}

/** Two documents that exchange every update, like two browsers through the server. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on(
    "update",
    (u: Uint8Array, origin: unknown) => origin !== "net" && Y.applyUpdate(b, u, "net"),
  );
  b.on(
    "update",
    (u: Uint8Array, origin: unknown) => origin !== "net" && Y.applyUpdate(a, u, "net"),
  );
  return { a, b };
}

describe("diffEdit", () => {
  it("finds the smallest edit", () => {
    expect(diffEdit("hello", "hello")).toBeNull();
    expect(diffEdit("hello", "hello!")).toEqual({ index: 5, remove: 0, insert: "!" });
    expect(diffEdit("hello", "hllo")).toEqual({ index: 1, remove: 1, insert: "" });
    expect(diffEdit("abcd", "abXYd")).toEqual({ index: 2, remove: 1, insert: "XY" });
    expect(diffEdit("", "x")).toEqual({ index: 0, remove: 0, insert: "x" });
    expect(diffEdit("aaa", "aa")).toEqual({ index: 2, remove: 1, insert: "" });
  });
});

describe("deltaToEdits and applyTextEdits", () => {
  it("reads a Yjs delta in the coordinates of the old text", () => {
    const doc = new Y.Doc();
    const t = doc.getText("t");
    t.insert(0, "hello world");
    let edits: TextEdit[] = [];
    t.observe((e) => (edits = deltaToEdits(e.delta as never)));
    doc.transact(() => {
      t.delete(0, 5); // "hello" goes
      t.insert(0, "howdy"); // and "howdy" comes
      t.insert(t.length, "!");
    });
    expect(applyTextEdits("hello world", edits)).toBe(t.toString());
    expect(t.toString()).toBe("howdy world!");
  });
  it("applies several edits at once from the original coordinates", () => {
    expect(
      applyTextEdits("abcdef", [
        { index: 4, remove: 1, insert: "X" },
        { index: 1, remove: 0, insert: "--" },
      ]),
    ).toBe("a--bcdXf");
  });
});

describe("moveOffset", () => {
  it("keeps a caret in place relative to the text around it", () => {
    expect(moveOffset(10, [{ index: 2, remove: 0, insert: "abc" }])).toBe(13);
    expect(moveOffset(10, [{ index: 12, remove: 0, insert: "abc" }])).toBe(10);
    expect(moveOffset(10, [{ index: 2, remove: 4, insert: "" }])).toBe(6);
    expect(moveOffset(5, [{ index: 2, remove: 6, insert: "xy" }])).toBe(4);
  });
});

describe("bindText", () => {
  it("shows the shared text first, then follows typing in both directions", () => {
    const { a, b } = pair();
    a.getText("code").insert(0, "x = 1\n");
    const fa = fakeField();
    const fb = fakeField("stale");
    bindText(a.getText("code"), fa);
    bindText(b.getText("code"), fb);
    expect(fa.text).toBe("x = 1\n");
    expect(fb.text).toBe("x = 1\n");

    fa.type({ index: 6, remove: 0, insert: "y = 2\n" });
    expect(fb.text).toBe("x = 1\ny = 2\n");
    fb.type({ index: 0, remove: 1, insert: "total" });
    expect(fa.text).toBe("total = 1\ny = 2\n");
    expect(b.getText("code").toString()).toBe(a.getText("code").toString());
  });

  it("converges when both people type at the same moment", () => {
    // updates are held back, then delivered, as on a slow network
    const a = new Y.Doc();
    const b = new Y.Doc();
    const held: Array<() => void> = [];
    a.on(
      "update",
      (u: Uint8Array, o: unknown) => o !== "net" && held.push(() => Y.applyUpdate(b, u, "net")),
    );
    b.on(
      "update",
      (u: Uint8Array, o: unknown) => o !== "net" && held.push(() => Y.applyUpdate(a, u, "net")),
    );
    a.getText("code").insert(0, "middle");
    held.splice(0).forEach((f) => f());
    const fa = fakeField();
    const fb = fakeField();
    bindText(a.getText("code"), fa);
    bindText(b.getText("code"), fb);
    fa.type({ index: 0, remove: 0, insert: "A-" });
    fb.type({ index: 6, remove: 0, insert: "-B" });
    fb.type({ index: 0, remove: 0, insert: "B0-" });
    held.splice(0).forEach((f) => f());
    expect(fa.text).toBe(fb.text);
    expect(fa.text).toContain("middle");
    expect(fa.text).toContain("A-");
    expect(fa.text).toContain("-B");
    expect(fa.text).toContain("B0-");
  });

  it("stops following after it is undone", () => {
    const doc = new Y.Doc();
    const f = fakeField();
    const off = bindText(doc.getText("code"), f);
    f.type({ index: 0, remove: 0, insert: "a" });
    off();
    f.type({ index: 1, remove: 0, insert: "b" });
    doc.getText("code").insert(0, "z");
    expect(doc.getText("code").toString()).toBe("za");
    expect(f.text).toBe("ab");
  });
});
