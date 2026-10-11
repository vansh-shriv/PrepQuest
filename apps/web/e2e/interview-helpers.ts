import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025/api/v1";

/** Follows the verification email Mailpit received for `email` (AI interviews need a verified account). */
export async function verifyEmail(page: Page, email: string) {
  for (let i = 0; i < 20; i++) {
    const list = await page.request.get(
      `${MAILPIT}/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const messages = ((await list.json()) as { messages?: Array<{ ID: string }> }).messages ?? [];
    for (const m of messages) {
      const msg = await page.request.get(`${MAILPIT}/message/${m.ID}`);
      const text = ((await msg.json()) as { Text: string }).Text;
      const match = text.match(/https?:\/\/\S*verify-email\S*/);
      if (match) {
        await page.goto(match[0]);
        await expect(page.getByText("QUEST COMPLETE! Your email is verified.")).toBeVisible();
        return;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no verification email for ${email}`);
}

/** A one-page text PDF (enough for the resume parser). */
export function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 11 Tf 40 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

type MonacoGlobal = { editor: { getModels(): { setValue(v: string): void }[] } };

/** Replaces the whole text of the Monaco editor through its API (typing fights the auto-indent). */
export async function setEditorText(page: Page, code: string) {
  await page.waitForFunction(
    () =>
      ((window as unknown as { monaco?: MonacoGlobal }).monaco?.editor.getModels().length ?? 0) > 0,
  );
  await page.evaluate((text) => {
    (window as unknown as { monaco: MonacoGlobal }).monaco.editor.getModels()[0]!.setValue(text);
  }, code);
}
