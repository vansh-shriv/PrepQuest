import { Suspense } from "react";
import { VerifyEmail } from "./verify";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
