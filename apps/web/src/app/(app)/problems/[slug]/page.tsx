"use client";

import { use } from "react";
import { ProblemWorkspace } from "@/components/problems/ProblemWorkspace";

export default function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <ProblemWorkspace slug={slug} />;
}
