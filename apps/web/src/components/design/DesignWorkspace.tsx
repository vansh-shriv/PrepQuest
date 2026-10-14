"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button, LoadingBar, Sprite } from "@prepquest/ui";
import { NODE_LABEL, type NodeType } from "@prepquest/analytics-core";
import type { DesignPromptDetail } from "@prepquest/shared";
import { Markdown } from "@/components/problems/Markdown";
import {
  TOOLBAR,
  canvasToSvg,
  exportJson,
  fileName,
  saveStateText,
  NODE_TOKEN,
  type Palette,
} from "@/features/design/design-view";
import { fromDraft, useDesign } from "@/features/design/use-design";
import { api } from "@/lib/api";
import { CanvasEditor } from "./CanvasEditor";
import { DesignPanel } from "./DesignPanel";
import { DesignReference, DesignReview } from "./DesignReview";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The colours of the design tokens as they are right now, for an export that has no stylesheet. */
function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim() || "#888888";
  return {
    ink: token("--ink"),
    surface: token("--bg"),
    fills: Object.fromEntries(TOOLBAR.map((t) => [t, token(NODE_TOKEN[t])])) as Record<
      NodeType,
      string
    >,
  };
}

/** `/design/[id]`: the canvas, the structured panel, the review and the reference designs. */
export function DesignWorkspace({ id }: { id: string }) {
  const d = useDesign(id);
  const [prompt, setPrompt] = useState<DesignPromptDetail | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const slug = d.doc?.prompt.slug;

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    api<DesignPromptDetail>(`/design/prompts/${slug}`)
      .then((p) => alive && setPrompt(p))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug]);

  if (d.missing) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <Sprite name="dino" scale={6} label="Dino" />
        <h1 className="pq-font-display m-0 text-base leading-relaxed">NOT FOUND</h1>
        <Link href="/system-design" className="underline">
          Back to system design
        </Link>
      </div>
    );
  }
  if (!d.doc || !d.canvas || !d.panel) return <LoadingBar label="Loading the design" />;
  const { doc, canvas, panel } = d;

  const onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const target = e.target as HTMLElement;
    // typing in a text box keeps the browser's own undo
    if (!mod || target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if (e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      d.undo();
    } else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
      e.preventDefault();
      d.redo();
    }
  };

  const exportPng = () => {
    const svg = canvasToSvg(canvas, readPalette());
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width * 2;
      c.height = img.height * 2;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      c.toBlob((b) => b && download(fileName(doc.prompt.title, "png"), b));
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  const exportAsJson = () =>
    download(
      fileName(doc.prompt.title, "json"),
      new Blob([exportJson(doc.prompt.title, canvas, fromDraft(panel))], {
        type: "application/json",
      }),
    );

  const components = canvas.nodes.filter((n) => n.type !== "note").length;

  return (
    <div className="grid max-w-6xl gap-5" onKeyDown={onKey} data-testid="design-workspace">
      <header className="grid gap-1">
        <Link href="/system-design" className="pq-font-ui text-xs uppercase underline">
          System design
        </Link>
        <h1 className="pq-font-display m-0 text-base leading-relaxed">{doc.prompt.title}</h1>
        <p className="m-0 text-sm text-ink-soft" role="status" data-testid="save-state">
          {saveStateText(d.save)}
          {d.save === "conflict" && (
            <>
              {" "}
              <button type="button" className="underline" onClick={() => void d.reload()}>
                Reload the saved version
              </button>
            </>
          )}
        </p>
      </header>

      {prompt && (
        <details open={components === 0}>
          <summary className="cursor-pointer underline">The problem</summary>
          <div className="mt-2">
            <Markdown>{prompt.statementMd}</Markdown>
          </div>
        </details>
      )}

      <section className="grid gap-2" aria-labelledby="canvas-h">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="canvas-h" className="pq-font-ui m-0 text-sm uppercase">
            Canvas
          </h2>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={d.undo} disabled={!d.canUndo}>
              Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={d.redo} disabled={!d.canRedo}>
              Redo
            </Button>
            <Button size="sm" variant="ghost" onClick={exportPng}>
              Export PNG
            </Button>
            <Button size="sm" variant="ghost" onClick={exportAsJson}>
              Export JSON
            </Button>
          </span>
        </div>
        <CanvasEditor canvas={canvas} onChange={d.edit} highlight={highlight} />
        <p className="m-0 text-xs text-ink-soft">
          {components} component{components === 1 ? "" : "s"} · {canvas.edges.length} connection
          {canvas.edges.length === 1 ? "" : "s"} · types:{" "}
          {TOOLBAR.map((t) => NODE_LABEL[t]).join(", ")}
        </p>
      </section>

      <section className="grid gap-2" aria-labelledby="panel-h">
        <h2 id="panel-h" className="pq-font-ui m-0 text-sm uppercase">
          Notes and numbers
        </h2>
        <DesignPanel panel={panel} onChange={d.setPanel} hints={prompt?.requirementHints} />
      </section>

      <DesignReview
        doc={doc}
        canAsk={components >= 2}
        saveNow={d.saveNow}
        onDoc={d.setDoc}
        onRefresh={d.refresh}
        onHighlight={setHighlight}
      />
      <DesignReference slug={doc.prompt.slug} />
    </div>
  );
}
