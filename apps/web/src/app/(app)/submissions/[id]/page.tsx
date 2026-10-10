"use client";

import { use } from "react";
import { SubmissionDetailView } from "@/components/library/SubmissionDetailView";

export default function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SubmissionDetailView id={id} />;
}
