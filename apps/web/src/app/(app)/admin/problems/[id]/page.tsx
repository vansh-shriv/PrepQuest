"use client";

import { use } from "react";
import { ProblemEditor } from "@/components/admin/ProblemEditor";

export default function EditProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProblemEditor id={id} />;
}
