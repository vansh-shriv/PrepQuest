"use client";

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { Select } from "@prepquest/ui";
import { applyTheme } from "../../problems/CodeEditor";
import {
  applyTextEdits,
  bindText,
  moveOffset,
  type TextEdit,
  type TextField,
} from "@/features/peer/room/text-sync";

export const ROOM_LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "cpp", label: "C++" },
  { value: "java", label: "Java" },
  { value: "plaintext", label: "Plain text" },
] as const;
type RoomLanguage = (typeof ROOM_LANGUAGES)[number]["value"];

const LOAD_TIMEOUT_MS = 10_000;

function monacoField(editor: Parameters<OnMount>[0], monaco: Monaco): TextField {
  const model = editor.getModel()!;
  // one line ending for everyone, so offsets mean the same thing in both browsers
  model.setEOL(monaco.editor.EndOfLineSequence.LF);
  return {
    value: () => model.getValue(),
    replace: (edits: TextEdit[]) =>
      model.applyEdits(
        edits.map((e) => {
          const from = model.getPositionAt(e.index);
          const to = model.getPositionAt(e.index + e.remove);
          return {
            range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
            text: e.insert,
            forceMoveMarkers: true,
          };
        }),
      ),
    onChange: (cb) => {
      const d = model.onDidChangeContent(cb);
      return () => d.dispose();
    },
  };
}

function textareaField(el: HTMLTextAreaElement): TextField {
  const listeners = new Set<() => void>();
  const onInput = () => listeners.forEach((cb) => cb());
  el.addEventListener("input", onInput);
  return {
    value: () => el.value,
    replace: (edits) => {
      const start = moveOffset(el.selectionStart, edits);
      const end = moveOffset(el.selectionEnd, edits);
      el.value = applyTextEdits(el.value, edits);
      el.setSelectionRange(start, end);
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) el.removeEventListener("input", onInput);
      };
    },
  };
}

/**
 * The code both people edit. The text lives in the shared document (`code`), the language in `meta`. Monaco
 * owns what is typed (see CodeEditor), a plain text box takes over if Monaco cannot load.
 */
export function SharedEditor({ doc }: { doc: Y.Doc }) {
  const [fallback, setFallback] = useState(false);
  const loaded = useRef(false);
  const unbind = useRef<(() => void) | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const [language, setLanguage] = useState<RoomLanguage>("python");
  const editorRef = useRef<{ editor: Parameters<OnMount>[0]; monaco: Monaco } | null>(null);

  // the language is shared too: either person can change it
  useEffect(() => {
    const meta = doc.getMap<string>("meta");
    const read = () => {
      const v = meta.get("language");
      if (ROOM_LANGUAGES.some((l) => l.value === v)) setLanguage(v as RoomLanguage);
    };
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [doc]);
  useEffect(() => {
    const cur = editorRef.current;
    const model = cur?.editor.getModel();
    if (cur && model) cur.monaco.editor.setModelLanguage(model, language);
  }, [language]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loaded.current) setFallback(true);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => () => unbind.current?.(), []);

  // the plain text box is bound once it is on the page
  useEffect(() => {
    if (!fallback || !textarea.current) return;
    unbind.current?.();
    unbind.current = bindText(doc.getText("code"), textareaField(textarea.current));
  }, [fallback, doc]);

  const onMount: OnMount = (editor, monaco) => {
    loaded.current = true;
    editorRef.current = { editor, monaco };
    applyTheme(monaco);
    unbind.current?.();
    unbind.current = bindText(doc.getText("code"), monacoField(editor, monaco));
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, language);
  };

  return (
    <div className="grid gap-2" data-testid="peer-editor">
      <Select
        label="Language"
        value={language}
        onChange={(e) => doc.getMap<string>("meta").set("language", e.target.value)}
      >
        {ROOM_LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </Select>
      <div className="h-96 border-2 border-ink">
        {fallback ? (
          <textarea
            ref={textarea}
            aria-label="Shared code"
            data-testid="peer-editor-fallback"
            spellCheck={false}
            className="h-full w-full resize-none border-0 bg-surface p-3 text-ink outline-none"
            style={{ fontFamily: "var(--font-code)", fontSize: 14, tabSize: 4 }}
          />
        ) : (
          <Editor
            height="100%"
            language={language}
            defaultValue=""
            onMount={onMount}
            loading={<p className="pq-font-pixel m-0 p-4 text-xl">Loading editor...</p>}
            options={{
              fontFamily:
                getComputedStyle(document.documentElement).getPropertyValue("--font-code") ||
                "monospace",
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 4,
              padding: { top: 12, bottom: 12 },
              accessibilitySupport: "auto",
            }}
          />
        )}
      </div>
    </div>
  );
}
