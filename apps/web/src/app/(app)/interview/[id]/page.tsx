"use client";

import { use } from "react";
import { InterviewRoom } from "@/components/interview/InterviewRoom";

export default function InterviewRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <InterviewRoom id={id} />;
}
