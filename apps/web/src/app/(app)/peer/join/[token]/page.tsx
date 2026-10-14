"use client";

import { use } from "react";
import { PeerJoin } from "@/components/peer/PeerJoin";

export default function PeerJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <PeerJoin token={token} />;
}
