"use client";

import { Suspense } from "react";
import { NewInterview } from "@/components/interview/NewInterview";

export default function NewInterviewPage() {
  // useSearchParams needs a Suspense boundary in the App Router
  return (
    <Suspense>
      <NewInterview />
    </Suspense>
  );
}
