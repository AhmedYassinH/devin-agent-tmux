---
version: "1.1"
name: instrument
description: >
  A precision-instrument design system. Cold graphite surfaces, machined-brass
  accent, and typography borrowed from engineering documentation. Dark-first
  with a full cold-paper light mode. Built for software that has to look
  credible before it looks exciting: AI tooling, financial products, dashboards,
  and technical marketing sites. Every color is WCAG-verified, every component
  has all five interaction states, and the accent appears roughly six times
  per screen — never as decoration.
license: CC0-1.0
tags: [dark-first, light-mode, precision, fintech, ai, dashboard, landing-page, accessible]

# ─────────────────────────────────────────────────────────────
# COLOR — hex is authoritative, OKLCH given for programmatic ramps
# ─────────────────────────────────────────────────────────────
colors:
  dark:
    canvas:            { hex: "#0B0F14", oklch: "16.7% 0.012 254" }  # page background
    surface-1:         { hex: "#131922", oklch: "21.2% 0.020 258" }  # cards, panels
    surface-2:         { hex: "#1B222C", oklch: "25.0% 0.022 257" }  # nested, inputs
    surface-3:         { hex: "#242C38", oklch: "29.1% 0.025 258" }  # hover, active rows
    hairline:          { hex: "#2C3542", oklch: "32.6% 0.026 258" }  # default 1px border
    hairline-strong:   { hex: "#3D4857", oklch: "39.8% 0.029 256" }  # emphasis border
    ink:               { hex: "#E9EDF2", oklch: "94.4% 0.008 254" }  # primary text  16.4:1
    ink-2:             { hex: "#A6B2C0", oklch: "75.9% 0.024 252" }  # secondary     8.9:1
    ink-3:             { hex: "#7B8895", oklch: "60.8% 0.026 250" }  # captions      5.3:1
    accent:            { hex: "#C8A15A", oklch: "73.0% 0.101  81" }  # brass         8.0:1
    accent-hover:      { hex: "#DDB771", oklch: "79.8% 0.099  82" }
    accent-press:      { hex: "#A9843F", oklch: "63.5% 0.098  81" }
    accent-wash:       { hex: "#C8A15A1F" }                          # 12% tint fill
    on-accent:         { hex: "#0B0F14" }                            # text on brass fill
    focus-ring:        { hex: "#DDB771" }
    overlay:           { hex: "#0B0F14CC" }                          # 80% scrim
  light:
    canvas:            { hex: "#EEF1F4", oklch: "95.7% 0.005 248" }  # cold newsprint
    surface-1:         { hex: "#FFFFFF" }
    surface-2:         { hex: "#F6F8FA" }
    surface-3:         { hex: "#EAEEF2" }
    hairline:          { hex: "#D8DEE6", oklch: "89.8% 0.013 256" }
    hairline-strong:   { hex: "#BCC5D0" }
    ink:               { hex: "#0B0F14" }                            # 17.0:1
    ink-2:             { hex: "#4A5665" }                            #  6.6:1
    ink-3:             { hex: "#5E6B7A" }                            #  4.8:1
    accent:            { hex: "#8A6220", oklch: "52.6% 0.096  76" }  # brass, text-safe 4.8:1
    accent-fill:       { hex: "#C8A15A" }                            # fill only, dark ink on top
    accent-hover:      { hex: "#6F4E19" }
    accent-wash:       { hex: "#C8A15A24" }
    on-accent:         { hex: "#0B0F14" }
    focus-ring:        { hex: "#8A6220" }
    overlay:           { hex: "#0B0F1499" }
  status:
    # Never used for CTAs or branding. Always paired with an icon or a text label —
    # color alone never carries the meaning.
    success:           { hex: "#3DD68C", light: "#1A7F52" }  # 10.3:1 on canvas
    warning:           { hex: "#E8833A", light: "#9A4E12" }  #  7.1:1
    danger:            { hex: "#E5484D", light: "#B02128" }  #  4.9:1
    info:              { hex: "#5B9DF9", light: "#1F5FBF" }  #  7.0:1

# ─────────────────────────────────────────────────────────────
# TYPE — three faces, three jobs. No face does double duty.
# ─────────────────────────────────────────────────────────────
typography:
  families:
    display: "'Cabinet Grotesk', 'Neue Haas Grotesk Display', system-ui, sans-serif"
    body:    "'IBM Plex Sans', system-ui, -apple-system, sans-serif"
    mono:    "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace"
  sources:
    display: "https://www.fontshare.com/fonts/cabinet-grotesk (free, Fontshare)"
    body:    "https://fonts.google.com/specimen/IBM+Plex+Sans (OFL)"
    mono:    "https://fonts.google.com/specimen/IBM+Plex+Mono (OFL)"
  scale:
    display-xl:  { family: display, size: "clamp(3rem, 7vw, 5.25rem)",   weight: 700, lineHeight: 1.02, tracking: "-0.035em" }
    display-lg:  { family: display, size: "clamp(2.25rem, 4.5vw, 3.5rem)", weight: 700, lineHeight: 1.06, tracking: "-0.03em" }
    display-md:  { family: display, size: "clamp(1.75rem, 3vw, 2.5rem)",   weight: 600, lineHeight: 1.12, tracking: "-0.022em" }
    heading:     { family: display, size: "1.5rem",   weight: 600, lineHeight: 1.2,  tracking: "-0.015em" }
    subheading:  { family: body,    size: "1.125rem", weight: 600, lineHeight: 1.35, tracking: "-0.008em" }
    body-lg:     { family: body,    size: "1.0625rem", weight: 400, lineHeight: 1.6, tracking: "0" }
    body:        { family: body,    size: "0.9375rem", weight: 400, lineHeight: 1.65, tracking: "0" }
    body-sm:     { family: body,    size: "0.875rem",  weight: 400, lineHeight: 1.55, tracking: "0" }
    label:       { family: body,    size: "0.8125rem", weight: 500, lineHeight: 1.4,  tracking: "0.005em" }
    readout:     { family: mono,    size: "0.75rem",   weight: 500, lineHeight: 1.3,  tracking: "0.09em", transform: uppercase }
    data:        { family: mono,    size: "0.875rem",  weight: 450, lineHeight: 1.45, tracking: "0", numeric: "tabular-nums" }
    code:        { family: mono,    size: "0.8125rem", weight: 400, lineHeight: 1.7 }
  rules:
    - Display face never drops below 24px and never runs longer than two lines.
    - Body copy caps at 68 characters per line.
    - All numerals in tables, metrics, prices, and timestamps use `data` with tabular-nums.
    - Never use the mono face for prose. It labels, measures, and reports — nothing else.

# ─────────────────────────────────────────────────────────────
# SPACE, SHAPE, DEPTH, MOTION
# ─────────────────────────────────────────────────────────────
spacing:
  base: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160]
  section-y: { mobile: 64, tablet: 96, desktop: 128 }
  gutter:    { mobile: 20, tablet: 32, desktop: 40 }
  container: { max: 1240, prose: 680, wide: 1440 }
  grid:      { columns: 12, gap: 24 }

radius:
  none: 0        # tables, readout rules, data cells
  sm: 4          # inputs, tags, checkboxes
  md: 8          # buttons, small cards
  lg: 12          # cards, panels, modals
  xl: 16          # hero panels, feature blocks
  full: 9999      # avatars and status dots only

elevation:
  # Dark mode builds depth with surface lightness + hairlines, not shadow.
  # Shadow appears only on floating layers.
  flat:    "none"
  raised:  "0 1px 2px rgb(0 0 0 / 0.32)"
  overlay: "0 8px 24px -6px rgb(0 0 0 / 0.48), 0 2px 6px rgb(0 0 0 / 0.32)"
  modal:   "0 24px 64px -12px rgb(0 0 0 / 0.62)"
  ring:    "0 0 0 3px #DDB77159"   # focus, both modes

motion:
  duration: { instant: 90, fast: 140, base: 200, slow: 320, ambient: 600 }
  easing:
    standard: "cubic-bezier(0.2, 0, 0, 1)"
    entrance: "cubic-bezier(0.05, 0.7, 0.1, 1)"
    exit:     "cubic-bezier(0.3, 0, 0.8, 0.15)"
  rules:
    - Animate transform and opacity only. Never animate width, height, or box-shadow.
    - Entrances travel at most 8px. Nothing slides in from off-screen.
    - Every transition is wrapped in `@media (prefers-reduced-motion: reduce)` fallbacks.

# ─────────────────────────────────────────────────────────────
# ICONS — added v1.1. Engraved, not illustrated.
# ─────────────────────────────────────────────────────────────
icons:
  set: "Lucide (ISC) — or any 24px-grid stroke set with square terminals"
  style: stroke
  stroke-width: 1.5      # 1.75 below 16px so the line survives
  linecap: square        # NOT round — this is an engraved system
  linejoin: miter
  sizes:
    xs: 14   # inline with body-sm and readout labels
    sm: 16   # inside buttons and inputs
    md: 20   # nav, table row actions
    lg: 24   # card headers, empty states
    xl: 40   # feature blocks only — never larger
  color:
    default: ink-2
    emphasis: ink
    on-accent: on-accent
    decorative: ink-3
  gap:
    icon-to-label: 8     # inside a button or link
    icon-to-text: 12     # in a list row or feature block
  rules:
    - An icon never appears in brass unless it sits on a brass fill.
    - Never fill an icon. Never duotone. Never rounded caps.
    - Icon-only buttons carry `aria-label` and a 44x44 hit area, always.
    - Do not put an icon on every button. A leading icon is reserved for actions
      that leave the page or change state on the machine — download, external
      link, copy, install.
---

# Instrument — DESIGN.md

## 1. Visual theme and atmosphere

The reference object is a well-made measuring instrument: a bench multimeter, an
altimeter, a Braun calculator. Cold graphite housing, machined brass detail,
engraved labels, and readouts that are legible at a glance because someone
decided legibility mattered more than mood.

That produces three atmospheric commitments:

**Cold, not black.** The canvas is `#0B0F14` — a blue-shifted graphite, not pure
black and not a neutral gray. Pure black on a screen reads as an absence. This
reads as a machined surface with light falling on it.

**Warm metal, used sparingly.** The single accent is brass `#C8A15A`. It is the
only warm color in the interface and the only saturated one outside status
states. Because nothing else competes with it, it does not need to be bright to
be seen. Count the brass on any finished screen: six appearances or fewer.

**Density with air.** Information is packed tightly inside a component and given
generous room between components. Tables are dense. Sections are not.

The system is deliberately not atmospheric. There are no gradients on surfaces,
no glows, no glass blur, no mesh backgrounds, no floating orbs. Depth comes from
surface lightness steps and hairlines. If a screen looks flat, that is the
intended result.

---

## 2. Color palette and roles

### Dark mode (default)

| Token | Hex | Role |
|---|---|---|
| `canvas` | `#0B0F14` | Page background. Never used on a component. |
| `surface-1` | `#131922` | Cards, panels, nav bar, footer. |
| `surface-2` | `#1B222C` | Inputs, nested cards, table headers. |
| `surface-3` | `#242C38` | Hover state for rows and list items. |
| `hairline` | `#2C3542` | Default 1px border on every surface. |
| `hairline-strong` | `#3D4857` | Table rules, focused input border, dividers that carry meaning. |
| `ink` | `#E9EDF2` | Headings and primary body. 16.4:1. |
| `ink-2` | `#A6B2C0` | Secondary body, descriptions, inactive nav. 8.9:1. |
| `ink-3` | `#7B8895` | Captions, timestamps, placeholder, readout labels. 5.3:1. |
| `accent` | `#C8A15A` | Primary CTA fill, active nav indicator, focus ring, link underline. 8.0:1. |
| `accent-wash` | `#C8A15A` @ 12% | Selected row, active tab background, badge fill. |
| `on-accent` | `#0B0F14` | Text and icons sitting on a brass fill. |

### Light mode (cold paper)

Light mode is not an inversion. It is a second material: cold newsprint
`#EEF1F4` with white cards floating on it. The brass darkens to `#8A6220` for
anything that carries text or an icon, because the marketing brass fails
contrast on white. The fill brass stays `#C8A15A` and always carries dark ink.

### Status colors

Success `#3DD68C`, warning `#E8833A`, danger `#E5484D`, info `#5B9DF9` — with
darkened light-mode variants in the front matter. These are strictly reserved:

- A status color never appears on a button that isn't a destructive action.
- A status color is never the brand accent, and brass is never a status.
- Status is always carried by an icon or word as well as color.

---

## 3. Typography rules

Three faces, three jobs, no overlap.

**Cabinet Grotesk** carries display. It is tight, engineered, and slightly odd in
the heavy weights, which is exactly what gives headlines a voice. Used at 700
with aggressive negative tracking (`-0.035em` at hero size) so the headline reads
as a single machined block rather than a row of letters.

**IBM Plex Sans** carries everything a person reads in sentences. It was drawn
for technical documentation, it has a humanist warmth that keeps long copy from
feeling clinical, and it is genuinely free.

**IBM Plex Mono** carries measurement: eyebrow labels, table numerals, metric
readouts, code, timestamps, IDs, and key-value pairs. Set in uppercase at
`0.09em` tracking, it looks engraved. This is the face that does the most work in
making the system feel like an instrument, and it is the one most likely to be
misused — see the Don'ts.

**Hierarchy is built with size and tracking, not weight.** The system uses only
400, 500, 600, and 700. Anything in between reads as indecision.

---

## 4. Component stylings

### Button — primary
```
background: accent (#C8A15A)   color: on-accent (#0B0F14)
font: label 13px/500            height: 40px (sm 32, lg 48)
padding: 0 18px                 radius: md (8px)
border: none                    transition: 140ms standard
```
| State | Change |
|---|---|
| hover | background → `accent-hover` `#DDB771`, `translateY(-1px)` |
| active | background → `accent-press` `#A9843F`, `translateY(0)` |
| focus-visible | `ring` — `0 0 0 3px #DDB77159`, offset 2px |
| disabled | background `surface-3`, text `ink-3`, cursor not-allowed |
| loading | text holds width, mono spinner replaces label, button stays same size |

### Button — secondary
`surface-2` fill, `hairline-strong` border, `ink` text. Hover raises the fill to
`surface-3` and the border to brass at 40%. Same geometry as primary.

### Button — ghost
No fill, no border, `ink-2` text. Hover fills with `accent-wash` and lifts text
to `ink`. Used in table rows and toolbars.

### Card
```
background: surface-1     border: 1px hairline
radius: lg (12px)         padding: 24px (32px on lg)
shadow: flat              transition: 200ms standard
```
Hover — only if the card is a link — raises the border to `hairline-strong` and
the fill to `surface-2`. Cards do not lift, scale, or glow.

**Instrument card variant:** a card whose top edge carries the readout rule
(see Signature). Used for metrics, model cards, and pricing tiers.

### Input
```
background: surface-2     border: 1px hairline
height: 40px              radius: sm (4px)
padding: 0 12px           font: body 15px
placeholder: ink-3
```
Focus replaces the border with `hairline-strong` and adds the brass ring. Error
replaces the border with `danger` and prints the message below in `body-sm`
`danger`, prefixed with an icon. Labels sit above in `label`, never inside as
placeholders.

### Navigation
Nav bar is `surface-1` at 64px, bottom hairline, no shadow. Links are `ink-2` at
`label`. The active link is `ink` with a 2px brass underline sitting on the nav's
bottom hairline. Sticky nav gains `raised` elevation after 40px of scroll — no
blur, no background change.

### Table
Header row `surface-2`, `readout` labels, bottom `hairline-strong`. Body rows
`surface-1` with `hairline` separators, `radius: none`, 44px tall. All numeric
cells use `data` with tabular numerals, right-aligned. Row hover → `surface-3`.
Selected row → `accent-wash` with a 2px brass left edge.

### Badge / tag
`radius: sm`, 22px tall, `readout` type, `accent-wash` fill with `accent` text —
or the matching status wash for status badges.

### Modal
`surface-1`, `radius: lg`, `modal` shadow, 480px default width, `overlay` scrim
behind it. Enters with `opacity 0→1` and `translateY(8px→0)` over 200ms
`entrance`. Never scales in.

### Button — download *(v1.1)*
The primary button with a leading `sm` (16px) icon, 8px gap, and 20px right
padding to compensate for the icon's optical weight. The label names the file it
gets: "Download for macOS", never "Download now". A `readout`-styled sub-label
below the button carries version and size — `v0.4.2 · 18 MB · Apple silicon`.

### Wordmark / logo lockup *(v1.1)*
A 20px brass glyph followed by the product name in the display face at 600,
`-0.02em`, with 10px between them. The glyph is the only brass in the nav bar. In
light mode the glyph fills with `accent-fill` and the name uses `ink`. Minimum
clear space around the lockup is the height of the glyph.

### Command line *(v1.1)*
```
background: surface-2     border: 1px hairline
radius: sm (4px)          height: 44px
padding: 0 12px           font: code (IBM Plex Mono 13px)
prompt: ink-3             command: ink
```
A copy button sits flush right as a ghost icon button. On copy, the icon swaps to
a check and the border flashes to `accent` for 900ms, then returns. The command
text is selectable. Never truncate it — wrap to a second line on mobile instead.

### Terminal / pane block *(v1.1)*
The display surface for anything that represents a running process.
```
background: canvas        border: 1px hairline
radius: md (8px)          padding: 16px
font: code                line-height: 1.7
```
It sits on `surface-1`, one step *darker* than its parent — inset, not raised.
The header is a readout rule. An active or focused pane gains a 2px brass left
edge and `hairline-strong` on the remaining three sides. Output text is `ink-2`;
paths, IDs, and numerals are `ink`; only genuine errors take `danger`.

### Status dot *(v1.1)*
6px, `radius: full`, always followed by a `readout` label 8px to its right. Never
alone. Running `success`, queued `ink-3`, blocked `warning`, failed `danger`. A
running dot may pulse opacity 1 → 0.45 over 1.6s; nothing else animates.

### Footer *(v1.1)*
`surface-1` with a top hairline, 64px vertical padding, four columns collapsing
to two at `md` and one at `sm`. Column headings use `readout`, links use
`body-sm` in `ink-2` rising to `ink` on hover. The wordmark repeats at the left
with the version in `data` type beside it. No newsletter form, no social icon
row — if a link matters it goes in a column.

---

## 5. Layout principles

- 12-column grid, 24px gutters, 1240px max container, 680px prose measure.
- Vertical rhythm is a 4px base with an 8px working step. Section padding runs
  64 / 96 / 128 across mobile / tablet / desktop.
- **Sections are separated by space, not by alternating background colors.** The
  canvas stays `#0B0F14` the whole way down. Where a section genuinely needs
  separation, use a full-bleed hairline, not a fill.
- Left-align everything by default. Centered text is reserved for the hero
  headline and empty states.
- One primary action per screen region. If two buttons sit next to each other,
  only one is brass.
- Asymmetry is allowed and encouraged in content sections: a 7/5 split reads more
  considered than 6/6.

---

## 6. Depth and elevation

Depth is built from four surface steps and two hairline weights. Shadow is a
last resort reserved for things that actually float — dropdowns, popovers,
toasts, modals, and the sticky nav after scroll.

```
canvas → surface-1 → surface-2 → surface-3
```

Never stack more than three surface steps in one composition. If a card inside a
card inside a card is needed, the design is wrong, not the token scale.

In light mode the relationship inverts: white cards sit above a gray canvas, and
`raised` becomes a genuine soft shadow rather than an outline.

---

## 7. Do's and don'ts

**Do**
- Keep brass to six or fewer appearances per screen.
- Give every interactive element a visible `focus-visible` ring.
- Use the readout face for anything numeric, tabular, or measured.
- Let sections breathe — when in doubt, add 32px of vertical space, not a border.
- Ship both modes. The light mode is designed, not generated.

**Don't**
- Don't add gradients to surfaces, buttons, or text. There are none in this system.
- Don't use brass as a body-text color, a hover fill for large areas, or a background for a whole section.
- Don't set prose in the mono face. It labels and measures; it does not narrate.
- Don't put a shadow on a card. Cards are anchored, not floating.
- Don't alternate section backgrounds to create rhythm.
- Don't use border-radius above 16px on anything but avatars and status dots.
- Don't use icon-only buttons without an accessible label.
- Don't animate anything on scroll beyond an 8px fade-and-rise, once.
- Don't introduce a second accent color. If something needs to stand out from the brass, give it space instead.

---

## 8. Responsive behavior

| Breakpoint | Width | Behavior |
|---|---|---|
| `sm` | < 640px | Single column. Gutters 20px. Display-xl clamps to 3rem. Nav collapses to a sheet. Tables become stacked key-value cards using `readout` keys. |
| `md` | 640–1023px | Two columns max. Gutters 32px. Sidebars move below content. |
| `lg` | 1024–1439px | Full 12-column grid. Gutters 40px. Sidebars return. |
| `xl` | ≥ 1440px | Container caps at 1240px and centers. Content does not stretch further. |

- Minimum touch target is 44×44px, always, including icon buttons in dense tables.
- Hover states are wrapped in `@media (hover: hover)`.
- Type scales fluidly via `clamp()` at display sizes; body sizes are fixed.
- Reduced motion removes all transforms and keeps opacity fades at 90ms.

---

## 9. Signature element — the readout rule

The one thing this system should be remembered by.

A hairline rule with a mono micro-label sitting on it, like the engraved scale on
an instrument face. It replaces the generic section eyebrow and the generic card
header.

```
────────────────────────────────────────────────
  MODEL LATENCY / P95                    2.1.4
────────────────────────────────────────────────
```

Construction: a 1px `hairline-strong` line running the full width of its
container, with a `readout`-styled label sitting flush left on `canvas` fill so
it interrupts the rule. An optional right-flush value in `data` type. Above every
major section, at the top of every metric card, and above every table group.

It works because it does real work: it names the thing, it groups the thing, and
it carries a number when there is one. It is not decoration.

**Its one rule:** never more than one readout rule per visual group. The moment
they stack, the instrument becomes a spreadsheet.

---

## 10. Agent prompt guide

**Quick reference**

```
canvas #0B0F14 · surface-1 #131922 · surface-2 #1B222C · hairline #2C3542
ink #E9EDF2 · ink-2 #A6B2C0 · ink-3 #7B8895 · accent #C8A15A
display Cabinet Grotesk 700 · body IBM Plex Sans 400 · mono IBM Plex Mono 500
radius 8 buttons / 12 cards · space 4px base · motion 200ms cubic-bezier(.2,0,0,1)
```

**Ready-to-use prompts**

> Build a landing page hero using DESIGN.md. Left-aligned, `display-xl` headline
> in Cabinet Grotesk with `-0.035em` tracking, a `body-lg` subhead in `ink-2`
> capped at 68 characters, one brass primary button and one secondary. Put a
> readout rule above the headline. No gradient, no background image.

> Build a metrics dashboard using DESIGN.md. Four instrument cards in a 12-column
> grid, each with a readout rule on top, the value in `display-md`, and the delta
> in `data` type using a status color with an arrow icon. Below, a dense table
> with tabular numerals and brass row selection.

> Build a pricing section using DESIGN.md. Three instrument cards, `surface-1`
> with hairline borders. The recommended tier gets a brass 1px border and a
> brass badge — nothing else changes. All three buttons the same size; only the
> recommended one is brass.

> Convert this component to DESIGN.md. Replace every shadow with a surface step
> plus hairline, replace every gradient with a flat fill, move all numerals to
> `data` type with tabular-nums, and add a `focus-visible` brass ring.

**Setup**

1. Save this file as `DESIGN.md` in your project root, next to `README.md`.
2. Add to `CLAUDE.md` or `.cursor/rules`: *"Read DESIGN.md before generating or
   editing any UI. Use only tokens defined there."*
3. Load fonts: IBM Plex Sans and Mono from Google Fonts, Cabinet Grotesk from
   Fontshare. If Cabinet Grotesk is unavailable, fall back to IBM Plex Sans at
   700 with `-0.03em` tracking rather than substituting another display face.
