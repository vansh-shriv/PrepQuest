"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  Dialog,
  FolderCard,
  Input,
  LoadingBar,
  SPRITE_NAMES,
  SearchPill,
  Sprite,
  StageBar,
  Tabs,
  ThemeSwitcher,
  ToastProvider,
  Window,
  useToast,
} from "@prepquest/ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="pq-font-display text-sm">{title}</h2>
      {children}
    </section>
  );
}

function Demo() {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <main className="mx-auto max-w-5xl space-y-12 p-6 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="pq-font-display text-lg">Design system</h1>
        <ThemeSwitcher />
      </header>

      <Section title="Sprites">
        <div className="flex flex-wrap gap-8">
          {SPRITE_NAMES.map((n) => (
            <figure key={n} className="m-0 text-center">
              <Sprite name={n} scale={5} animate label={n} />
              <figcaption className="pq-font-ui text-xs">{n}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-4">
          <Button>Menu</Button>
          <Button
            variant="accent"
            onClick={() => toast({ message: "+25 XP", coin: true, tone: "success" })}
          >
            Quest complete
          </Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Run</Button>
          <Button onClick={() => setOpen(true)}>Open dialog</Button>
        </div>
      </Section>

      <Section title="Windows and cards">
        <div className="grid gap-6 sm:grid-cols-2">
          <Window title="Download" tone="coin">
            <LoadingBar value={40} label="Download 40%" />
          </Window>
          <Window title="Fatal error" tone="danger">
            The application failed. Try again?
          </Window>
          <Card>Plain card with notched outline and hard shadow.</Card>
          <FolderCard title="Striver SDE Sheet" meta="12 / 40 solved" progress={30} />
        </div>
      </Section>

      <Section title="Forms">
        <div className="grid max-w-md gap-5">
          <Input label="Email" placeholder="you@college.edu" helper="We never share it." />
          <Input label="Password" type="password" error="Too short" defaultValue="abc" />
          <SearchPill />
        </div>
      </Section>

      <Section title="Progress">
        <div className="grid max-w-md gap-6">
          <LoadingBar label="Interviewer is thinking" />
          <StageBar stages={["Queued", "Compiling", "Running", "Done"]} current={2} label="Judge" />
        </div>
      </Section>

      <Section title="Tabs and chips">
        <div className="max-w-lg space-y-4">
          <Tabs
            aria-label="Demo tabs"
            items={[
              { id: "a", label: "Statement", content: "Problem statement." },
              { id: "b", label: "Hints", content: "Three tiers of hints." },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Chip tone="easy">Easy</Chip>
            <Chip tone="medium">Medium</Chip>
            <Chip tone="hard">Hard</Chip>
            <Chip tone="info">Arrays</Chip>
          </div>
        </div>
      </Section>

      <Dialog open={open} onClose={() => setOpen(false)} title="Quest accepted!">
        <p className="mb-4">Good luck. Press Esc to close.</p>
        <Button onClick={() => setOpen(false)}>OK</Button>
      </Dialog>
    </main>
  );
}

export function DesignShowcase() {
  return (
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
}
