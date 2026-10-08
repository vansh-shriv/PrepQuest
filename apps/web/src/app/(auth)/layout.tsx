import type { ReactNode } from "react";
import { GuestOnly } from "@/components/auth/GuestOnly";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <GuestOnly>{children}</GuestOnly>;
}
