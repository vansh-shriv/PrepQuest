import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import { buttonClasses } from "@prepquest/ui";
import type { PublicReportDto } from "@prepquest/shared";
import { PrintButton } from "@/components/share/PrintButton";
import { ReportView } from "@/components/share/ReportView";
import { reportDescription } from "@/features/share/share-view";
import { API_URL } from "@/lib/api";

type Params = Promise<{ token: string }>;

/**
 * Server-side fetch of the filtered report. A revoked, expired or unknown link all answer 404. `cache` makes
 * the metadata and the page share one request, so a visit counts as one view.
 */
const load = cache(async (token: string): Promise<PublicReportDto | null> => {
  try {
    const res = await fetch(`${API_URL}/v1/r/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PublicReportDto;
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token } = await params;
  const report = await load(token);
  if (!report) return { title: "Report not found | PrepQuest", robots: { index: false } };
  const image = `${API_URL}/v1/r/${encodeURIComponent(token)}/og.png`;
  const title = `${report.title} | PrepQuest`;
  const description = reportDescription(report.payload);
  return {
    title,
    description,
    // the link is the secret: do not hand it to other sites through the Referer header
    referrer: "no-referrer",
    robots: report.visibility === "unlisted" ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: image, width: 1200, height: 630, alt: report.title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SharedReportPage({ params }: { params: Params }) {
  const { token } = await params;
  const report = await load(token);
  if (!report) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4 py-8">
      <ReportView report={report} />
      <footer className="no-print flex flex-wrap items-center gap-3">
        <PrintButton />
        <Link href="/signup" className={buttonClasses({ variant: "accent" })}>
          Practise on PrepQuest
        </Link>
        <p className="m-0 text-sm text-ink-soft">
          Shared by the learner. PrepQuest does not vouch for it beyond what the scoring rules
          produced.
        </p>
      </footer>
    </main>
  );
}
