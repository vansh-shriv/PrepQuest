import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Button,
  Card,
  Chip,
  Dialog,
  FolderCard,
  Input,
  LoadingBar,
  SearchPill,
  StageBar,
  Tabs,
  ThemeSwitcher,
  ToastProvider,
  useToast,
  Window,
} from "../index";

const meta: Meta = { title: "Components" };
export default meta;

export const Buttons: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
      <Button>Menu</Button>
      <Button variant="accent">Start quest</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Delete</Button>
      <Button disabled>Disabled</Button>
      <Button loading>Run</Button>
      <Button size="sm">Small</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const Windows: StoryObj = {
  render: () => (
    <div
      style={{
        display: "grid",
        gap: 24,
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      }}
    >
      <Card>Plain card</Card>
      <Window title="Error" tone="coin">
        Unknown error. <Button size="sm">OK</Button>
      </Window>
      <Window title="Download" tone="sky">
        <LoadingBar value={25} label="Download 25%" />
      </Window>
      <Window title="Fatal error" tone="danger">
        The application failed.
      </Window>
      <Window title="solution.cpp" tone="olive">
        Editor chrome goes here.
      </Window>
    </div>
  ),
};

export const Forms: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 20, maxWidth: 360 }}>
      <Input label="Email" placeholder="you@college.edu" helper="We never share it." />
      <Input label="Password" type="password" error="Too short" defaultValue="abc" />
      <SearchPill />
    </div>
  ),
};

export const Progress: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 24, maxWidth: 420 }}>
      <LoadingBar value={60} label="Loading" />
      <LoadingBar label="Interviewer is thinking" />
      <StageBar stages={["Queued", "Compiling", "Running", "Done"]} current={2} label="Judge" />
    </div>
  ),
};

export const TabsAndChips: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 24, maxWidth: 480 }}>
      <Tabs
        aria-label="Problem sections"
        items={[
          { id: "desc", label: "Statement", content: "Problem statement." },
          { id: "hints", label: "Hints", content: "Three tiers of hints." },
          { id: "sub", label: "Submissions", content: "Your attempts." },
        ]}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Chip tone="easy">Easy</Chip>
        <Chip tone="medium">Medium</Chip>
        <Chip tone="hard">Hard</Chip>
        <Chip tone="info">Arrays</Chip>
        <Chip tone="special">Rare</Chip>
      </div>
      <FolderCard title="Striver SDE Sheet" meta="12 / 40 solved" progress={30} />
    </div>
  ),
};

function Overlays() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <div style={{ display: "flex", gap: 16 }}>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Button
        variant="accent"
        onClick={() => toast({ message: "+25 XP", coin: true, tone: "success" })}
      >
        Toast
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Quest accepted!">
        <p>Good luck. Press Esc to close.</p>
        <Button onClick={() => setOpen(false)}>OK</Button>
      </Dialog>
    </div>
  );
}

export const DialogAndToast: StoryObj = {
  render: () => (
    <ToastProvider>
      <Overlays />
    </ToastProvider>
  ),
};

export const Themes: StoryObj = { render: () => <ThemeSwitcher /> };
