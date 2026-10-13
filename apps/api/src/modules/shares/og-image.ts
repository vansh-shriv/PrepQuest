import { deflateSync } from "node:zlib";

// The preview image of a shared report (U5), drawn in pixel art with a small built-in 5x7 font and encoded as
// a PNG without any dependency. Pure: same input, same bytes. 1200x630 is the size link previews expect.

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

type Rgb = readonly [number, number, number];

const INK: Rgb = [30, 36, 51];
const GOLD: Rgb = [232, 183, 48];
const CREAM: Rgb = [243, 233, 210];
const BROWN: Rgb = [92, 70, 48];
const DARK: Rgb = [43, 33, 24];
const GREEN: Rgb = [76, 154, 79];
const RED: Rgb = [200, 85, 61];

// 5 columns x 7 rows per glyph, '#' is a lit pixel.
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "%": ["##..#", "##..#", "...#.", "..#..", ".#...", "#..##", "#..##"],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

/** Uppercase, and anything the font cannot draw becomes a space. */
export function drawable(text: string): string {
  return text
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .split("")
    .map((ch) => (GLYPHS[ch] ? ch : " "))
    .join("");
}

class Canvas {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    bg: Rgb,
  ) {
    // each scanline starts with a filter byte (0 = none)
    this.data = new Uint8Array((w * 3 + 1) * h);
    this.rect(0, 0, w, h, bg);
  }

  rect(x: number, y: number, w: number, h: number, c: Rgb) {
    const x0 = Math.max(0, x);
    const x1 = Math.min(this.w, x + w);
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      let i = yy * (this.w * 3 + 1) + 1 + x0 * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.data[i++] = c[0];
        this.data[i++] = c[1];
        this.data[i++] = c[2];
      }
    }
  }

  text(raw: string, x: number, y: number, scale: number, c: Rgb) {
    let cx = x;
    for (const ch of drawable(raw)) {
      const g = GLYPHS[ch]!;
      for (let r = 0; r < 7; r++)
        for (let k = 0; k < 5; k++)
          if (g[r]![k] === "#") this.rect(cx + k * scale, y + r * scale, scale, scale, c);
      cx += 6 * scale;
    }
  }
}

/** Width in pixels of a text drawn at a scale. */
export const textWidth = (text: string, scale: number) => text.length * 6 * scale;

let crcTable: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

export function encodePng(c: Canvas): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(c.data, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export interface OgCard {
  /** Small label above the title, e.g. MOCK INTERVIEW SCORECARD. */
  heading: string;
  title: string;
  /** The big number or rank, e.g. "78" or "#3". */
  big: string;
  /** Small text after the big number, e.g. "/100". */
  unit?: string;
  /** One line under the big number, e.g. the band. */
  sub?: string;
  /** "good" shows the number in green, "weak" in red; default is dark. */
  tone?: "good" | "weak" | "plain";
  /** Up to four lines on the right, e.g. dimension scores. */
  lines?: string[];
  footer: string;
}

function wrap(text: string, max: number, lines: number): string[] {
  const words = drawable(text).trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= max) line = next;
    else {
      if (line) out.push(line);
      line = w.length > max ? `${w.slice(0, max - 1)}-` : w;
    }
  }
  if (line) out.push(line);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = `${out[lines - 1]!.slice(0, max - 3).trimEnd()}...`;
  }
  return out;
}

/** Draw the report card as a 1200x630 PNG. */
export function renderOgPng(card: OgCard): Buffer {
  const c = new Canvas(OG_WIDTH, OG_HEIGHT, INK);
  // notched gold frame and a cream panel
  c.rect(24, 36, 1152, 558, GOLD);
  c.rect(36, 24, 1128, 582, GOLD);
  c.rect(42, 42, 1116, 546, CREAM);
  c.rect(48, 36, 1104, 558, CREAM);
  c.text("PREPQUEST", 84, 78, 4, BROWN);
  c.text(card.heading, 84, 126, 3, BROWN);
  wrap(card.title, 28, 2).forEach((line, i) => c.text(line, 84, 176 + i * 60, 6, DARK));

  const numColor = card.tone === "good" ? GREEN : card.tone === "weak" ? RED : DARK;
  c.text(card.big, 84, 330, 16, numColor);
  if (card.unit) c.text(card.unit, 84 + textWidth(card.big, 16) + 6, 400, 6, BROWN);
  if (card.sub) c.text(wrap(card.sub, 22, 1)[0] ?? "", 84, 470, 5, DARK);

  (card.lines ?? []).slice(0, 4).forEach((line, i) => {
    c.rect(640, 330 + i * 56, 6, 36, GOLD);
    c.text(wrap(line, 19, 1)[0] ?? "", 664, 334 + i * 56, 4, DARK);
  });

  c.text(wrap(card.footer, 44, 1)[0] ?? "", 84, 534, 3, BROWN);
  return encodePng(c);
}
