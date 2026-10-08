"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  defaultId?: string;
  onChange?: (id: string) => void;
  "aria-label"?: string;
}

export function Tabs({ items, defaultId, onChange, "aria-label": ariaLabel }: TabsProps) {
  const base = useId();
  const [active, setActive] = useState(defaultId ?? items[0]?.id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    setActive(id);
    onChange?.(id);
    refs.current[id]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = items.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    const target = items[next];
    if (target) select(target.id);
  };

  const current = items.find((i) => i.id === active);

  return (
    <div className="pq-tabs">
      <div className="pq-tabs__list" role="tablist" aria-label={ariaLabel}>
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${item.id}`}
            aria-controls={`${base}-panel-${item.id}`}
            aria-selected={item.id === active}
            tabIndex={item.id === active ? 0 : -1}
            className="pq-tab"
            onClick={() => select(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {current ? (
        <div
          role="tabpanel"
          className="pq-tabs__panel"
          id={`${base}-panel-${current.id}`}
          aria-labelledby={`${base}-tab-${current.id}`}
        >
          {current.content}
        </div>
      ) : null}
    </div>
  );
}
