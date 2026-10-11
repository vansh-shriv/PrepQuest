import { AppError } from "@prepquest/shared";

/** Plain text from an uploaded resume. Rejects files whose bytes do not match the claimed type. */
export async function extractResumeText(buffer: Buffer, mime: string): Promise<string> {
  const text = mime === "application/pdf" ? await fromPdf(buffer) : await fromDocx(buffer);
  return text
    .replaceAll(String.fromCharCode(0), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fromPdf(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function fromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

/** First bytes must match the declared type (a renamed .exe must not get through). */
export function sniffResumeMime(
  buffer: Buffer,
):
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | null {
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

export function assertEnoughText(text: string): void {
  if (text.length < 80) {
    throw new AppError(
      "RESUME_UNREADABLE",
      422,
      "We couldn't read text from this file. If it is a scanned image, export a text-based PDF or DOCX.",
    );
  }
}
