import { Chip } from "@prepquest/ui";
import { syncText } from "@/features/flashcards/flashcard-view";

/** Says where the learner's answers are: waiting on this device, syncing, or nothing to report. */
export function SyncBadge({ pending, online }: { pending: number; online: boolean }) {
  const text = syncText(pending, online);
  if (!text) return null;
  return (
    <p className="m-0 flex items-center gap-2 text-sm" role="status" data-testid="sync-status">
      <Chip tone={online ? "info" : "medium"}>{online ? "sync" : "offline"}</Chip>
      <span>{text}</span>
    </p>
  );
}
