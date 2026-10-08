import { Suspense } from "react";
import { OAuthCallback } from "./callback";

export default function OAuthCallbackPage() {
  return (
    <Suspense>
      <OAuthCallback />
    </Suspense>
  );
}
