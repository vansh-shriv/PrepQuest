"use client";

import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { DataSection } from "@/components/settings/DataSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { SecuritySection } from "@/components/settings/SecuritySection";
import { SessionsSection } from "@/components/settings/SessionsSection";

export default function SettingsPage() {
  return (
    <div className="grid gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Settings</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-6">
          <ProfileSection />
          <DataSection />
        </div>
        <div className="grid content-start gap-6">
          <AppearanceSection />
          <SecuritySection />
          <SessionsSection />
        </div>
      </div>
    </div>
  );
}
