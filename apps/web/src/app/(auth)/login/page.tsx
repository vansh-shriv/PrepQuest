import { Suspense } from "react";
import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
