"use client";

import { use } from "react";
import { DesignWorkspace } from "@/components/design/DesignWorkspace";

export default function DesignWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DesignWorkspace id={id} />;
}
