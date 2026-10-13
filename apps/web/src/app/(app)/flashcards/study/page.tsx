"use client";

import { Suspense } from "react";
import { StudySession } from "@/components/flashcards/StudySession";

// useSearchParams needs a Suspense boundary for a static build
export default function StudyPage() {
  return (
    <Suspense fallback={null}>
      <StudySession />
    </Suspense>
  );
}
