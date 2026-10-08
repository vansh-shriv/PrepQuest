/**
 * Original pixel art, drawn as character grids. '.' is transparent; every other
 * character is looked up in the sprite's palette. Colors reference design tokens so
 * sprites follow the active theme. Redrawn from scratch (the reference sheet is style
 * guidance only).
 */
export interface SpriteArt {
  palette: Record<string, string>;
  rows: string[];
  /** CSS animation class applied by <Sprite animate /> */
  animation?: "pq-spin" | "pq-twinkle" | "pq-blink";
}

const INK = "#1a1a1a";

const folderRowA = "K" + "FDFDFDFDFDFDFDFDFD" + "K";
const folderRowB = "K" + "DFDFDFDFDFDFDFDFDF" + "K";

export const SPRITES = {
  coin: {
    palette: { O: "#c26a12", Y: "var(--coin)", H: "#ffd27a" },
    animation: "pq-spin",
    rows: [
      "....OOOO....",
      "..OOYYYYOO..",
      ".OYYYYYYYYO.",
      ".OYYHYYYYYO.",
      "OYYYHYYYYYYO",
      "OYYYHYYYYYYO",
      "OYYYYYYYYYYO",
      "OYYYYYYYYYYO",
      ".OYYYYYYYYO.",
      ".OYYYYYYYYO.",
      "..OOYYYYOO..",
      "....OOOO....",
    ],
  },
  sparkle: {
    palette: { B: "var(--sky)", L: "var(--sky-light)" },
    animation: "pq-twinkle",
    rows: [
      "....B....",
      "....B....",
      "...BLB...",
      "BBBLLLBBB",
      "...BLB...",
      "....B....",
      "....B....",
    ],
  },
  dino: {
    palette: { K: INK, W: "#ffffff" },
    rows: [
      "..........KKKKKKKK.",
      ".........KKKKKKKKKK",
      ".........KKWKKKKKKK",
      ".........KKKKKKKKKK",
      ".........KKKKKKKKKK",
      ".........KKKKK.....",
      ".........KKKKKKK...",
      "K.......KKKKK......",
      "K......KKKKKKK.K...",
      "KK....KKKKKKKKKK...",
      "KKK..KKKKKKKKKKK...",
      ".KKKKKKKKKKKKKKK...",
      "..KKKKKKKKKKKKK....",
      "...KKKKKKKKKKK.....",
      "....KKKKKKKKK......",
      ".....KKK..KKK......",
      ".....KK....KK......",
      ".....KKK...KKK.....",
    ],
  },
  folder: {
    palette: { K: INK, F: "var(--folder)", D: "var(--folder-dark)" },
    rows: [
      ".KKKKKKK............",
      "KFFFFFFFK...........",
      "KFFFFFFFFKKKKKKKKKK.",
      "KFFFFFFFFFFFFFFFFFFK",
      ...Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? folderRowA : folderRowB)),
      "KKKKKKKKKKKKKKKKKKKK",
    ],
  },
  sunflower: {
    palette: {
      Y: "var(--sun)",
      B: "#7a4a1a",
      G: "var(--leaf)",
      S: "var(--leaf-dark)",
    },
    rows: [
      "...YYYYYY...",
      ".YYYBBBBYYY.",
      ".YYBBBBBBYY.",
      "YYYBBBBBBYYY",
      "YYYBBBBBBYYY",
      ".YYBBBBBBYY.",
      ".YYYBBBBYYY.",
      "...YYYYYY...",
      ".....SS.....",
      "..GG.SS.....",
      ".GGGGSS.....",
      "..GGGSS.....",
      ".....SS.GG..",
      ".....SSGGGG.",
      ".....SS.GGG.",
      ".....SS.....",
      ".....SS.....",
      ".....SS.....",
    ],
  },
  plant: {
    palette: { P: "var(--blossom)", S: "var(--leaf-dark)", G: "var(--leaf)", L: "var(--lime)" },
    rows: [
      "...PP...PP....",
      "...SS...SS....",
      "....S...S.....",
      "..G.SGGS..G...",
      ".GGGSGGSGGGGG.",
      "GGLGGGGGGGGLGG",
      ".GGGGLGGLGGGG.",
      "..GGGGGGGGGG..",
    ],
  },
  cursor: {
    palette: { K: INK, W: "var(--cursor)" },
    rows: [
      "K...........",
      "KK..........",
      "KWK.........",
      "KWWK........",
      "KWWWK.......",
      "KWWWWK......",
      "KWWWWWK.....",
      "KWWWWWWK....",
      "KWWWWWWWK...",
      "KWWWWWKKKK..",
      "KWWKWWK.....",
      "KWK.KWWK....",
      "KK..KWWK....",
      "K....KWWK...",
      ".....KWWK...",
      "......KK....",
    ],
  },
  // --- nav icons: single-color, inherit the surrounding text color ---
  home: {
    palette: { K: "currentColor" },
    rows: [
      "....K....",
      "...KKK...",
      "..KKKKK..",
      ".KKKKKKK.",
      "KKKKKKKKK",
      ".KKK.KKK.",
      ".KKK.KKK.",
      ".KKK.KKK.",
    ],
  },
  code: {
    palette: { K: "currentColor" },
    rows: [
      "...K...K...",
      "..K.....K..",
      ".K.......K.",
      "K.........K",
      ".K.......K.",
      "..K.....K..",
      "...K...K...",
    ],
  },
  chat: {
    palette: { K: "currentColor" },
    rows: [
      "KKKKKKKKKKK",
      "K.........K",
      "K.........K",
      "K.........K",
      "K.........K",
      "KKKKKKKKKKK",
      "..KK.......",
      "...K.......",
    ],
  },
  quiz: {
    palette: { K: "currentColor" },
    rows: [".KKKKK.", "K.....K", "......K", "....KK.", "...K...", "...K...", ".......", "...K..."],
  },
  plan: {
    palette: { K: "currentColor" },
    rows: [
      ".K.....K.",
      "KKKKKKKKK",
      "K.......K",
      "K.K.K.K.K",
      "K.......K",
      "K.K.K.K.K",
      "K.......K",
      "KKKKKKKKK",
    ],
  },
  chart: {
    palette: { K: "currentColor" },
    rows: [
      "......KK.",
      "......KK.",
      "......KK.",
      "...KK.KK.",
      "...KK.KK.",
      "KK.KK.KK.",
      "KK.KK.KK.",
      "KKKKKKKKK",
    ],
  },
  trophy: {
    palette: { K: "currentColor" },
    rows: [
      "KKKKKKKKK",
      "K.KKKKK.K",
      "K.KKKKK.K",
      ".KKKKKKK.",
      "..KKKKK..",
      "...KKK...",
      "....K....",
      "...KKK...",
      "..KKKKK..",
    ],
  },
  user: {
    palette: { K: "currentColor" },
    rows: [
      "...KKK...",
      "..KKKKK..",
      "..KKKKK..",
      "...KKK...",
      ".KKKKKKK.",
      "KKKKKKKKK",
      "KKKKKKKKK",
    ],
  },
  magnifier: {
    palette: { K: "var(--ink)" },
    rows: [
      ".KKKK....",
      "K....K...",
      "K....K...",
      "K....K...",
      "K....K...",
      ".KKKKK...",
      ".....KK..",
      "......KK.",
      ".......KK",
    ],
  },
} satisfies Record<string, SpriteArt>;

export type SpriteName = keyof typeof SPRITES;
export const SPRITE_NAMES = Object.keys(SPRITES) as SpriteName[];

export interface Run {
  x: number;
  y: number;
  w: number;
  color: string;
}

/** Collapse a sprite grid into horizontal single-color runs (fewer SVG rects). */
export function toRuns(art: SpriteArt): Run[] {
  const runs: Run[] = [];
  art.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x] as string;
      if (ch === ".") {
        x++;
        continue;
      }
      const color = art.palette[ch];
      if (!color) throw new Error(`Unknown palette key "${ch}" at row ${y}`);
      let w = 1;
      while (row[x + w] === ch) w++;
      runs.push({ x, y, w, color });
      x += w;
    }
  });
  return runs;
}
