import { Suspense } from "react";
import { ContestPage } from "@/components/contest/ContestPage";

export default function ContestDetailPage() {
  return (
    <Suspense>
      <ContestPage />
    </Suspense>
  );
}
