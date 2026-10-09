import { Suspense } from "react";
import { ProblemList } from "@/components/problems/ProblemList";

export default function ProblemsPage() {
  return (
    <Suspense>
      <ProblemList />
    </Suspense>
  );
}
