"use client";

import { useParams } from "next/navigation";
import { QuizRun } from "@/components/learning/QuizRun";

export default function QuizAttemptPage() {
  const { id } = useParams<{ id: string }>();
  return <QuizRun id={id} />;
}
