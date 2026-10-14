"use client";

import { use } from "react";
import { PeerSession } from "@/components/peer/PeerSession";

export default function PeerSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PeerSession id={id} />;
}
