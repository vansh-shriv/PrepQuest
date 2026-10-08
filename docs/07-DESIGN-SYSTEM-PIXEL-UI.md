# 07. Design System: Pixel UI ("Pixelmorphism")

A minimalist 90s pixel-game interface derived from the reference sheet: a warm cream canvas, crisp black pixel outlines, dithered checkerboard fills, hard offset shadows, and small iconic sprites (dino, folder, sparkles, cursor, sunflower, plant, MENU button, LOADING bar, coin).

**Design principle:** _Pixel on the chrome, calm on the content._ Pixel fonts, borders, icons, and motion are used for UI chrome and celebration. Long reading (problem statements, transcripts, editorials) and code use highly legible fonts so the theme never costs usability.

---

## 1. Visual language

| Trait         | Rule                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grid**      | Everything snaps to a 4 px base unit; art is drawn on an 8 px or 16 px grid. "One art pixel" = 4 CSS px by default (scales to 2/3 on small screens). |
| **Outlines**  | 2 px (half art pixel) to 4 px solid ink (`#1A1A1A`). Corners are **stepped** (notched), never smoothly rounded.                                      |
| **Shadows**   | **Hard offset shadows only**, no blur: `4px 4px 0 var(--shadow)`. Pressed state removes the shadow and translates the element.                       |
| **Fills**     | Flat colors plus **dither** (checkerboard) for texture, like the yellow folder.                                                                      |
| **Rendering** | `image-rendering: pixelated` on all sprites. No anti-aliased gradients on chrome.                                                                    |
| **Space**     | Generous whitespace. Minimalist: few elements per screen, one clear primary action.                                                                  |
| **Tone**      | Playful but not childish. Short, friendly microcopy ("Quest accepted!", "Level up!").                                                                |

---

## 2. Color palette

Sampled from the reference image.

### Core (Cream theme)

| Token           | Hex       | Use                                     |
| --------------- | --------- | --------------------------------------- |
| `--bg`          | `#FBF4E3` | Page background (cream)                 |
| `--surface`     | `#FFFFFF` | Cards, inputs, panels                   |
| `--surface-alt` | `#F4EBD3` | Secondary panels, table stripes         |
| `--ink`         | `#1A1A1A` | Outlines, primary text                  |
| `--ink-soft`    | `#4A4A4A` | Secondary text                          |
| `--shadow`      | `#C9C0A8` | Offset shadow color                     |
| `--sky`         | `#2BA8E8` | Primary accent (sparkles), links, focus |
| `--sky-light`   | `#9ADCF7` | Hover tint, info                        |
| `--folder`      | `#EDEB7A` | Folder yellow, highlights               |
| `--folder-dark` | `#C9C95A` | Folder shade, dither partner            |
| `--leaf`        | `#4FA23C` | Success, AC, progress fill              |
| `--leaf-dark`   | `#2A6B2E` | Success outline/text                    |
| `--lime`        | `#8EE05A` | Loading bar blocks                      |
| `--olive`       | `#6B8E4E` | MENU button, nav                        |
| `--sun`         | `#F2B820` | Sunflower, streak, warnings             |
| `--coin`        | `#F28C28` | XP coin, CTA accent                     |
| `--blossom`     | `#E58BC7` | Plant flower pink, special/rare badges  |
| `--cursor`      | `#C8CDD2` | Neutral gray, disabled                  |
| `--danger`      | `#D9483B` | WA/RE/CE verdicts, destructive          |

### Night Arcade (dark)

`--bg: #14161F`, `--surface: #1E2130`, `--surface-alt: #262A3D`, `--ink: #F5F0E1` (used for outlines/text), `--shadow: #0A0B10`, accents slightly brighter: `--sky: #4FC3F7`, `--leaf: #6FCF58`, `--sun: #FFD04A`, `--coin: #FF9E3D`, `--danger: #FF6B5E`.

### High Contrast

Pure `#000` / `#FFF`, 4 px outlines, accents darkened to meet 7:1, no dither.

### Verdict color mapping

| Verdict | Color           | Sprite                                    |
| ------- | --------------- | ----------------------------------------- |
| AC      | `--leaf`        | Sparkles burst                            |
| WA      | `--danger`      | Cracked pixel heart                       |
| TLE     | `--sun`         | Pixel hourglass                           |
| MLE     | `--coin`        | Overflowing block stack                   |
| RE      | `--danger` dark | Bug pixel                                 |
| CE      | `--blossom`     | Broken brackets                           |
| IE      | `--cursor`      | Dino with a wrench (our fault, not yours) |

---

## 3. Typography

| Role                             | Font                                                                          | Notes                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Display / headings / buttons** | **Press Start 2P** (Google Fonts)                                             | Use sparingly, uppercase, size 10 to 20 px multiples; line-height 1.5                       |
| **UI labels, nav, tags**         | **Silkscreen**                                                                | Small caps feel, 10 to 14 px                                                                |
| **Body text**                    | **VT323** for short UI text (22 to 26 px) **or** system sans for long reading | Long content (statements, transcripts, editorials) uses `Inter` or `IBM Plex Sans` at 16 px |
| **Code**                         | **JetBrains Mono** / **Fira Code**                                            | Never a pixel font in the editor                                                            |
| **Numbers in stats**             | Press Start 2P                                                                | Tabular feel                                                                                |

Rules:

- Never set paragraphs in Press Start 2P.
- Minimum body size 16 px for reading content.
- `font-smooth: never` / `-webkit-font-smoothing: none` for pixel fonts to keep crisp edges.

---

## 4. Tokens (CSS)

```css
:root {
  /* pixel unit */
  --px: 4px;
  --border: 3px;

  /* colors (cream) */
  --bg: #fbf4e3;
  --surface: #ffffff;
  --surface-alt: #f4ebd3;
  --ink: #1a1a1a;
  --ink-soft: #4a4a4a;
  --shadow: #c9c0a8;
  --sky: #2ba8e8;
  --sky-light: #9adcf7;
  --folder: #edeb7a;
  --folder-dark: #c9c95a;
  --leaf: #4fa23c;
  --leaf-dark: #2a6b2e;
  --lime: #8ee05a;
  --olive: #6b8e4e;
  --sun: #f2b820;
  --coin: #f28c28;
  --blossom: #e58bc7;
  --cursor: #c8cdd2;
  --danger: #d9483b;

  /* fonts */
  --font-display: "Press Start 2P", monospace;
  --font-ui: "Silkscreen", "Press Start 2P", monospace;
  --font-body-pixel: "VT323", monospace;
  --font-read: "Inter", "IBM Plex Sans", system-ui, sans-serif;
  --font-code: "JetBrains Mono", "Fira Code", monospace;
}

[data-theme="night"] {
  --bg: #14161f;
  --surface: #1e2130;
  --surface-alt: #262a3d;
  --ink: #f5f0e1;
  --ink-soft: #c9c4b5;
  --shadow: #0a0b10;
  --sky: #4fc3f7;
  --leaf: #6fcf58;
  --sun: #ffd04a;
  --coin: #ff9e3d;
  --danger: #ff6b5e;
}

[data-theme="contrast"] {
  --bg: #ffffff;
  --surface: #ffffff;
  --ink: #000000;
  --shadow: #000000;
  --border: 4px;
}

/* stepped (notched) corners using clip-path */
.pixel-box {
  background: var(--surface);
  border: var(--border) solid var(--ink);
  box-shadow: 4px 4px 0 var(--shadow);
  clip-path: polygon(
    0 4px,
    4px 4px,
    4px 0,
    calc(100% - 4px) 0,
    calc(100% - 4px) 4px,
    100% 4px,
    100% calc(100% - 4px),
    calc(100% - 4px) calc(100% - 4px),
    calc(100% - 4px) 100%,
    4px 100%,
    4px calc(100% - 4px),
    0 calc(100% - 4px)
  );
}
/* NOTE: clip-path clips box-shadow; use a wrapper with filter: drop-shadow(4px 4px 0 var(--shadow))
   or the "outline via multiple box-shadows" technique shown below for notched borders with shadows. */

/* dither checkerboard fill (folder look) */
.dither {
  background-color: var(--folder);
  background-image:
    linear-gradient(
      45deg,
      var(--folder-dark) 25%,
      transparent 25%,
      transparent 75%,
      var(--folder-dark) 75%
    ),
    linear-gradient(
      45deg,
      var(--folder-dark) 25%,
      transparent 25%,
      transparent 75%,
      var(--folder-dark) 75%
    );
  background-size: 8px 8px;
  background-position:
    0 0,
    4px 4px;
}

/* crisp sprites */
.sprite {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

/* stepped animation */
@keyframes blink-step {
  50% {
    opacity: 0;
  }
}
.blink {
  animation: blink-step 1s steps(1) infinite;
}
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}
```

### Notched border with shadow (recommended technique)

Use a wrapper that applies `filter: drop-shadow(4px 4px 0 var(--shadow))` and an inner element with `clip-path` and a 2-layer background to fake the outline:

```css
.pixel-card {
  filter: drop-shadow(4px 4px 0 var(--shadow));
}
.pixel-card__inner {
  background: var(--surface);
  padding: calc(var(--px) * 4);
  clip-path: polygon(
    0 4px,
    4px 4px,
    4px 0,
    calc(100% - 4px) 0,
    calc(100% - 4px) 4px,
    100% 4px,
    100% calc(100% - 4px),
    calc(100% - 4px) calc(100% - 4px),
    calc(100% - 4px) 100%,
    4px 100%,
    4px calc(100% - 4px),
    0 calc(100% - 4px)
  );
  box-shadow: inset 0 0 0 var(--border) var(--ink); /* inset outline, follows rectangle; corners get notched by clip-path */
}
```

---

## 5. Tailwind configuration

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="night"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-alt": "var(--surface-alt)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        shadow: "var(--shadow)",
        sky: "var(--sky)",
        "sky-light": "var(--sky-light)",
        folder: "var(--folder)",
        leaf: "var(--leaf)",
        "leaf-dark": "var(--leaf-dark)",
        lime: "var(--lime)",
        olive: "var(--olive)",
        sun: "var(--sun)",
        coin: "var(--coin)",
        blossom: "var(--blossom)",
        cursor: "var(--cursor)",
        danger: "var(--danger)",
      },
      fontFamily: {
        display: ["Press Start 2P", "monospace"],
        ui: ["Silkscreen", "monospace"],
        pixel: ["VT323", "monospace"],
        read: ["Inter", "IBM Plex Sans", "system-ui", "sans-serif"],
        code: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        pixel: "4px 4px 0 var(--shadow)",
        "pixel-sm": "2px 2px 0 var(--shadow)",
        "pixel-lg": "6px 6px 0 var(--shadow)",
      },
      borderWidth: { px: "3px" },
      spacing: { px: "4px" },
    },
  },
  plugins: [],
} satisfies Config;
```

---

## 6. Components

All components live in `packages/ui` (or `apps/web/src/components/pixel`) with Storybook stories.

### 6.1 Button (MENU-button style)

- Olive green fill (`--olive`), cream text, Press Start 2P, 3 px ink border, 4 px hard shadow, stepped corners.
- Variants: **primary** (olive), **accent** (coin orange, for the one CTA per screen), **ghost** (surface), **danger**, **disabled** (cursor gray, dithered).
- States: hover = lighten + shadow grows to 6 px; active = translate (4px, 4px) and shadow 0 ("pressed"); focus = 3 px sky outline offset by 3 px; loading = replaces label with 8-block mini loading bar.
- Sizes: sm (32 px), md (44 px), lg (56 px).

### 6.2 Search pill

- The "pixelated" search bar from the reference: pill with pixel magnifier icon, white fill, ink border, soft pixel shadow. Used in problem search and command palette.

### 6.3 Folder card

- Yellow dithered folder silhouette (tab on top-left) for **sheets, tracks, decks, interview templates**. Hover: folder "opens" (swap to open sprite frame). Shows title, progress bar, count.

### 6.4 Loading bar (LOADING)

- Black outlined rectangle, white fill, **lime blocks fill in discrete steps** (`steps(n)`), label "LOADING" in Press Start 2P above.
- Variants: determinate (progress), indeterminate (blocks march), and **stage bar** for judge: QUEUED, COMPILING, RUNNING, DONE.
- Used for: judge run, AI thinking ("INTERVIEWER IS THINKING"), scorecard generation, sheet progress, XP to next level, readiness gauge.

### 6.5 Coin (XP)

- Orange pixel coin with 4-frame spin animation (`steps(4)`), used in XP gain toasts (`+25`), level badge, rewards.

### 6.6 Sparkles

- Blue four-point pixel stars (3 sizes), appear at AC, level-up, goal complete, new badge. Animation: scale 0 to 1 to 0 in 6 steps, staggered.

### 6.7 Mouse cursor

- Custom pixel arrow cursor (gray with white highlight) sitewide on desktop; pointer variant (hand) for links; text caret unchanged in editor. Optional toggle in settings ("Retro cursor"). Sizes 32x32 PNG with hotspot defined; fallback to default if reduced-motion/accessibility mode.

### 6.8 Dino mascot ("Dino")

- Black pixel T-rex (top-left of reference). Roles:
  - **Empty states** and **404** ("This page went extinct").
  - **Offline mode** screen with a jumping dino mini-game while the connection recovers (easter egg).
  - **IE verdict** ("Our bad").
  - **Interviewer avatar option** (one of several pixel avatars).
  - **Loading** companion running along the loading bar.

### 6.9 Sunflower (streak)

- Stages by streak length: 0 days: seed; 1 to 2: sprout; 3 to 6: bud; 7 to 29: sunflower; 30 to 99: big sunflower with leaves; 100+: golden sunflower. Wilts (desaturated) if streak lost; "freeze" shown as ice-blue tint.

### 6.10 Skill plant (topic mastery)

- Green grass-and-flower plant: 4 stages (sprout, leafy, budding with pink flowers, full bloom). One per topic on dashboard and roadmap.

### 6.11 Inputs

- White fill, 3 px ink border, inset 2 px shadow at top-left; caret blinks in steps; error state: danger border and pixel "!" icon; helper text in VT323.
- Checkbox: square pixel box with pixel tick; Radio: diamond-notched circle; Toggle: sliding block "ON/OFF"; Slider: pixel track with block thumb; Select: pixel dropdown with stepped panel.

### 6.12 Cards and panels

- `pixel-card`: surface fill, ink border, hard shadow. **Title bar variant** (like an old window): colored bar with title and tiny `-` `[]` `x` pixel buttons; used for modals and floating tools (notes, hints).

### 6.13 Tabs

- Folder-tab style: active tab is raised and shares the panel's border; inactive tabs are dithered.

### 6.14 Chips and badges

- Difficulty: Easy (leaf), Medium (sun), Hard (danger), each with 8 px pixel gem icon.
- Verdict chips per table above.
- Company chips with tiny 16x16 pixelated initial glyphs (generic, not official logos).

### 6.15 Toasts and dialogs

- Toast slides in with stepped motion; includes coin or sparkle sprite. Dialog: title-bar window with backdrop in dither pattern (50% checkerboard overlay).

### 6.16 Tables and lists

- Zebra rows (`--surface-alt`), 2 px ink row separators, sticky header with olive fill.

### 6.17 Charts

- Charts in a **pixel style**: bars made of stacked squares, lines drawn with stepped segments and square markers, axes dotted, fonts VT323. Implementation via Recharts/visx with custom shapes; chart colors from tokens.
- Radar for scorecards: stepped polygon.

### 6.18 Editor chrome

- Monaco inside a `pixel-card` with title bar ("solution.cpp"); custom Monaco theme **"PrepQuest Cream"** and **"PrepQuest Night"** using palette (keywords sky, strings leaf, numbers coin, comments cursor gray, errors danger). Editor itself uses code font with smooth rendering for legibility.

### 6.19 Interview UI

- **Interviewer avatar** in a pixel frame with idle blink, "speaking" mouth animation tied to TTS audio level, "thinking" ellipsis (three blocks).
- **Chat bubbles**: interviewer bubble white with notched corners; user bubble folder-yellow; system notes in dithered gray.
- **Timer**: pixel digital clock (7-segment style sprite), turns sun then danger color as time shrinks.
- **Mic button**: big round-ish pixel button with level meter blocks.

---

## 7. Sprite and asset production

| Asset                 | Size (art px)   | Frames                             | Format                 |
| --------------------- | --------------- | ---------------------------------- | ---------------------- |
| Dino mascot           | 24x24           | idle(2), run(4), sad(1), wrench(2) | PNG sprite sheet + SVG |
| Folder closed/open    | 24x20           | 2                                  | PNG/SVG                |
| Sparkles              | 5x5, 9x9, 13x13 | 6-step anim                        | SVG                    |
| Cursor arrow/hand     | 16x16           | 1 each                             | CUR/PNG (32 px)        |
| Sunflower stages      | 16x32           | 6                                  | PNG                    |
| Skill plant stages    | 16x16           | 4                                  | PNG                    |
| Coin                  | 12x12           | 4                                  | PNG                    |
| MENU / button 9-slice | 24x16           | 9-slice                            | PNG                    |
| Loading bar           | 64x10           | block unit                         | CSS + SVG              |
| Verdict icons         | 12x12           | 7                                  | SVG                    |
| Topic icons           | 16x16           | ~30                                | SVG                    |
| Pixel avatars         | 32x32           | 24                                 | PNG                    |
| Badges                | 24x24           | ~40                                | PNG                    |

- Tools: **Aseprite** or **Piskel** for drawing; export 1x PNG and scale in CSS with `image-rendering: pixelated` (never export blurry upscales).
- **SVG-as-rects** pipeline: a script converts 1x PNG into optimized SVG rect runs so sprites are crisp at any zoom and themeable via CSS variables.
- Folder `apps/web/public/sprites/` with a generated `sprites.json` manifest; React `<Sprite name="coin" size={3} />` component handles scale and animation frames via `steps()`.
- Use the reference sheet as **style reference only**; redraw all sprites originally (the reference carries a studio watermark, do not copy its artwork directly).

---

## 8. Layout and navigation

- **Top bar**: logo (pixel "PQ" block), **MENU** button (opens a window-style nav drawer), search pill, XP coin counter, streak sunflower mini, avatar.
- **Left rail (desktop)**: icon-only pixel nav (Home, Practice, Interview, Quizzes, Plan, Analytics, Contests, Notes, Flashcards), expands on hover.
- **Mobile**: bottom tab bar with five pixel icons, "MENU" center button for more.
- **Max content width** 1280 px; problem page uses full-bleed split panes.
- **Spacing scale**: 4, 8, 12, 16, 24, 32, 48, 64.
- **Breakpoints**: 480 / 768 / 1024 / 1280.

---

## 9. Motion

- All animation uses **stepped timing** (`steps(n)`) for the frame-by-frame look; durations 150 to 400 ms.
- Page transitions: quick pixel wipe (blocks dissolve) under 250 ms.
- Celebrations: sparkles + coin burst on AC, confetti made of 4 px squares on level-up.
- **Reduced motion**: all non-essential motion disabled; state changes still communicated by color/icon.
- Sound (optional, off by default): 8-bit blips for AC, level-up, error; global mute and volume in settings; never autoplay at load.

---

## 10. Accessibility rules for the pixel theme

- Text contrast ratio at least 4.5:1 (7:1 in High Contrast). Check pixel font text on dithered backgrounds: **no text over dither**, only over flat fills.
- Focus indicators always visible: 3 px sky outline with 3 px offset.
- Do not rely on color alone for verdicts: icon + label.
- Pixel fonts have an off switch: "Readable mode" swaps display fonts to the read font while keeping borders and sprites.
- All sprites have `alt` text or `aria-hidden` when decorative.
- Touch targets at least 44 px even if the art is smaller.
- Screen reader live regions announce judge stage changes and new interviewer messages.

---

## 11. Microcopy guide (game flavor, short)

| Moment                                                                           | Copy                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| First AC                                                                         | "QUEST COMPLETE! +25 XP"                        |
| WA                                                                               | "NOT QUITE. CHECK THE EDGE CASES."              |
| TLE                                                                              | "TIME'S UP! TRY A FASTER APPROACH."             |
| Streak lost                                                                      | "Your sunflower wilted. Plant a new one today." |
| Empty state                                                                      | "NOTHING HERE YET. START A QUEST!"              |
| Interview start                                                                  | "BOSS FIGHT: 45 MIN. GOOD LUCK."                |
| Scorecard ready                                                                  | "RESULTS ARE IN!"                               |
| 404                                                                              | "THIS PAGE WENT EXTINCT."                       |
| Keep UI copy to under 8 words where possible; explanations go in readable fonts. |

---

## 12. Implementation checklist

1. Install fonts via `next/font` (Press Start 2P, Silkscreen, VT323, Inter, JetBrains Mono).
2. Add tokens CSS and Tailwind config above.
3. Build primitives: `Button`, `Card`, `Input`, `Tabs`, `Dialog`, `Toast`, `Progress`, `Sprite`.
4. Storybook with theme switcher and a11y addon.
5. Visual regression via Playwright screenshots for each component in 3 themes.
6. Build composite components: `JudgePanel`, `VerdictBanner`, `InterviewerAvatar`, `Timer`, `SkillPlant`, `StreakSunflower`, `RadarScore`.
7. Document usage rules (one accent CTA per screen, no more than 3 sprite types per view).

---

## 13. Implementation notes (as built in Phase 1)

Where the implementation intentionally differs from the sketches above:

- **Location:** `packages/ui` (`@prepquest/ui`), consumed from source. Styles: `src/styles/{tokens,base,components}.css`, imported via `@prepquest/ui/styles.css`. Class prefix `pq-`.
- **Notched border technique:** four offset `box-shadow`s (`0 -3px`, `0 3px`, `-3px 0`, `3px 0` in `--ink`) leave the corner pixels empty, giving stepped corners without `clip-path`. The hard shadow is `filter: drop-shadow(4px 4px 0 var(--shadow))`, which follows that outline. Utilities: `.pq-box` (outline + margin) and `.pq-lift` (shadow). Pressed buttons drop the filter and translate by the shadow offset.
- **Tailwind v4:** CSS-first `@theme inline` in `apps/web/src/app/globals.css` maps colors and shadows onto the tokens; there is no `tailwind.config.ts`. Fonts are applied through `.pq-font-display|ui|pixel` classes and tokens, loaded with `next/font` using the `--nf-*` variables (tokens fall back to the plain font names, e.g. in Storybook).
- **Sprites:** character-grid art in `src/sprites/art.ts`, rendered as SVG `<rect>` runs by `<Sprite name scale animate label />`. Colors reference tokens. The PNG-to-SVG `sprites:build` pipeline is not needed yet.
- **Themes:** `data-theme="cream|night|contrast"` and `data-readable="true"` on `<html>`; `THEME_INIT_SCRIPT` applies the saved choice before paint.
- **Contrast theme:** `--surface-alt` is a light gray (not white) so empty progress blocks and stripes remain visible.
- **Component inventory:** Button, Card, Window, Input, SearchPill, Tabs, LoadingBar, StageBar, Chip, FolderCard, Dialog, Toast, Sprite, ThemeSwitcher. Composite components listed in §12 step 6 are built alongside the features that need them.
