"use client";

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LanguageValue } from "@prepquest/shared";
import { toHex, toRuleColor, withAlpha } from "./editor-colors";

const MONACO_LANGUAGE: Record<LanguageValue | "sql", string> = {
  sql: "sql",
  cpp: "cpp",
  java: "java",
  python: "python",
};
/** If Monaco hasn't loaded after this long (offline, blocked CDN) fall back to a plain textarea. */
const LOAD_TIMEOUT_MS = 10_000;

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Builds the editor theme from the design tokens, so Cream, Night and Contrast stay in sync. */
export function applyTheme(monaco: Monaco) {
  const theme = document.documentElement.getAttribute("data-theme");
  const color = (token: string) => toHex(css(token));
  monaco.editor.defineTheme("prepquest", {
    base: theme === "night" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: toRuleColor(css("--sky")), fontStyle: "bold" },
      { token: "string", foreground: toRuleColor(css("--leaf")) },
      { token: "number", foreground: toRuleColor(css("--coin")) },
      { token: "comment", foreground: toRuleColor(css("--cursor")), fontStyle: "italic" },
      { token: "type", foreground: toRuleColor(css("--blossom")) },
    ],
    colors: {
      "editor.background": color("--surface"),
      "editor.foreground": color("--ink"),
      "editorLineNumber.foreground": color("--ink-soft"),
      "editorLineNumber.activeForeground": color("--ink"),
      "editor.lineHighlightBackground": color("--surface-alt"),
      "editor.selectionBackground":
        theme === "contrast" ? color("--sky-light") : withAlpha(css("--sky-light"), 0xaa),
      "editorCursor.foreground": color("--ink"),
      "editorError.foreground": color("--danger"),
      "editorIndentGuide.background1": color("--surface-alt"),
    },
  });
  monaco.editor.setTheme("prepquest");
}

export interface CodeEditorProps {
  /** Current code. Used to create the editor and whenever `revision` changes; NOT re-applied on every keystroke. */
  value: string;
  /** Bump to replace the editor's text with `value` (reset, restore, load newer). Typing never bumps it. */
  revision: number;
  language: LanguageValue | "sql";
  onChange: (code: string) => void;
  /** Where to put the caret when the editor opens. */
  initialCursor?: { line: number; column: number } | null;
  onCursorChange?: (cursor: { line: number; column: number }) => void;
  /** Called with the number of pasted characters (interviews record paste events). */
  onPaste?: (chars: number) => void;
  /** Ctrl/Cmd+Enter. */
  onRun?: () => void;
  /** Ctrl/Cmd+Shift+Enter. */
  onSubmit?: () => void;
  label?: string;
}

export function CodeEditor({
  value,
  revision,
  language,
  onChange,
  initialCursor,
  onCursorChange,
  onPaste,
  onRun,
  onSubmit,
  label = "Code editor",
}: CodeEditorProps) {
  const [fallback, setFallback] = useState(false);
  const loaded = useRef(false);
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loaded.current) setFallback(true);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // follow theme changes (data-theme on <html>)
  useEffect(() => {
    const observer = new MutationObserver(() => monacoRef.current && applyTheme(monacoRef.current));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // refs keep the mount handler stable: the caret is restored once, and later prop changes never move it
  const initialCursorRef = useRef(initialCursor);
  const onCursorRef = useRef(onCursorChange);
  onCursorRef.current = onCursorChange;
  const pasteRef = useRef(onPaste);
  pasteRef.current = onPaste;
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  const onMount = useCallback<OnMount>((editor, monaco) => {
    loaded.current = true;
    editorRef.current = editor;
    monacoRef.current = monaco;
    applyTheme(monaco);
    const start = initialCursorRef.current;
    if (start) {
      editor.setPosition({ lineNumber: start.line, column: start.column });
      editor.revealLineInCenter(start.line);
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
      submitRef.current?.(),
    );
    editor.onDidPaste((e) => {
      const model = editor.getModel();
      pasteRef.current?.(model ? model.getValueInRange(e.range).length : 0);
    });
    editor.onDidChangeCursorPosition((e) =>
      onCursorRef.current?.({ line: e.position.lineNumber, column: e.position.column }),
    );
  }, []);

  // Controlled `value` props fight with fast typing (a stale value overwrites newer keystrokes), so the
  // editor owns the text while the user types and is only told to replace it when `revision` changes.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || model.getValue() === valueRef.current) return;
    editor.pushUndoStop();
    editor.executeEdits("prepquest", [
      { range: model.getFullModelRange(), text: valueRef.current },
    ]);
    editor.pushUndoStop();
  }, [revision]);

  if (fallback) {
    return (
      <div className="flex h-full flex-col">
        <p role="status" className="m-0 bg-sun px-3 py-1 text-sm text-[var(--on-coin)]">
          The code editor couldn&apos;t load, so you&apos;re using a plain text box. Your work still
          autosaves.
        </p>
        <textarea
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => onPaste?.(e.clipboardData.getData("text").length)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              (e.shiftKey ? onSubmit : onRun)?.();
            }
          }}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none border-0 bg-surface p-3 text-ink outline-none"
          style={{ fontFamily: "var(--font-code)", fontSize: 14, tabSize: 4 }}
        />
      </div>
    );
  }

  return (
    <div className="h-full" data-testid="code-editor" aria-label={label}>
      <Editor
        height="100%"
        language={MONACO_LANGUAGE[language]}
        path={`solution.${language}`}
        defaultValue={value}
        onChange={(v) => onChange(v ?? "")}
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
          renderLineHighlight: "line",
          accessibilitySupport: "auto",
        }}
      />
    </div>
  );
}
