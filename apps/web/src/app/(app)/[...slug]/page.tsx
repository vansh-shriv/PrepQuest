"use client";

import { use } from "react";
import { Sprite } from "@prepquest/ui";
import { NAV_ITEMS } from "@/components/shell/nav";

/** Placeholder for sections that are planned but not built yet. */
export default function ComingSoonPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params);
  const item = NAV_ITEMS.find((i) => i.href === `/${slug[0]}`);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center">
      <Sprite name="dino" scale={6} label="Dino" />
      <h1 className="pq-font-display m-0 text-base leading-relaxed">
        {item ? item.label : "This page went extinct"}
      </h1>
      <p className="pq-font-pixel m-0 text-2xl">NOTHING HERE YET. START A QUEST!</p>
      {item?.phase && (
        <p className="m-0 text-sm text-ink-soft">Coming in build phase {item.phase}.</p>
      )}
    </div>
  );
}
