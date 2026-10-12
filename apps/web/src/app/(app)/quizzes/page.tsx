"use client";

import { Suspense } from "react";
import { QuizHome } from "@/components/learning/QuizHome";

export default function QuizzesPage() {
  return (
    <Suspense>
      <QuizHome />
    </Suspense>
  );
}
