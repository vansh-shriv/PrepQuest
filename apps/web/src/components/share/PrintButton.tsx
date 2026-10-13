"use client";

import { Button } from "@prepquest/ui";

/** Opens the print dialog; "Save as PDF" there gives a PDF of the report. */
export function PrintButton() {
  return (
    <Button variant="ghost" onClick={() => window.print()}>
      Save as PDF
    </Button>
  );
}
