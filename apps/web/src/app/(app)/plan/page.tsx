"use client";

import { Suspense } from "react";
import { PlanView } from "@/components/planning/PlanView";

export default function PlanPage() {
  return (
    <Suspense>
      <PlanView />
    </Suspense>
  );
}
