/**
 * Instrument design tokens that have to exist in code rather than in CSS.
 *
 * Almost everything lives in `styles.css` as custom properties. Two things
 * cannot: xterm.js takes its palette as a JS object, and a couple of values are
 * useful to components as literals. See DESIGN.md for the authoritative table.
 *
 * The eight Dell "catalog tints" that used to live here are gone. They were a
 * 1996 device — one flat colour per product line — and Instrument has exactly
 * one accent. Panes are now told apart by the surface/hairline system and a 2px
 * brass left edge on the focused one (DESIGN.md §4, "Terminal / pane block"),
 * which is both quieter and more informative: the highlight marks the pane you
 * are typing into rather than the arbitrary order it was opened in.
 */

/** The subset of Instrument colours that components need as JS literals. */
export const INSTRUMENT = {
  canvas: '#0B0F14',
  surface1: '#131922',
  surface2: '#1B222C',
  surface3: '#242C38',
  hairline: '#2C3542',
  hairlineStrong: '#3D4857',
  ink: '#E9EDF2',
  ink2: '#A6B2C0',
  ink3: '#7B8895',
  accent: '#C8A15A',
  accentHover: '#DDB771',
  accentPress: '#A9843F',
  onAccent: '#0B0F14',
  success: '#3DD68C',
  warning: '#E8833A',
  danger: '#E5484D',
  info: '#5B9DF9',
} as const;

/**
 * xterm palette, built from the Instrument colours.
 *
 * The terminal keeps the dark canvas in BOTH colour schemes. That is a
 * deliberate departure from the rest of the app: `devin` draws its TUI
 * light-on-dark with its own escape sequences, and there is no way to ask it for
 * a light rendering. A white terminal would leave Devin's own greys unreadable.
 * In light mode the pane card goes white and the terminal stays a dark display
 * window inset into it — which is exactly how a real instrument reads.
 *
 * The mapping (DESIGN.md §4, "Terminal / pane block"):
 *   background  canvas          the display surface, one step darker than the pane
 *   foreground  ink-2           "output text is ink-2"
 *   cursor      accent          the single brass appearance inside the display
 *   cyan/white  ink / ink-2     "paths, IDs, and numerals are ink"
 *   red         danger          "only genuine errors take danger"
 *   green/yellow/blue           success / warning / info, unchanged
 *   magenta     accent          Instrument has no second accent, so the one
 *                               remaining hue slot takes brass rather than
 *                               inventing a ninth colour.
 * Brights are pinned too — left unset, xterm falls back to its own neon
 * defaults and a single `\x1b[91m` would drop pure #ff0000 into the palette.
 */
export const TERMINAL_THEME = {
  background: INSTRUMENT.canvas,
  foreground: INSTRUMENT.ink2,
  cursor: INSTRUMENT.accent,
  cursorAccent: INSTRUMENT.canvas,
  selectionBackground: '#C8A15A3D',
  selectionForeground: INSTRUMENT.ink,

  black: INSTRUMENT.surface2,
  red: INSTRUMENT.danger,
  green: INSTRUMENT.success,
  yellow: INSTRUMENT.warning,
  blue: INSTRUMENT.info,
  magenta: INSTRUMENT.accent,
  cyan: INSTRUMENT.ink,
  white: INSTRUMENT.ink2,

  brightBlack: INSTRUMENT.hairlineStrong,
  brightRed: INSTRUMENT.danger,
  brightGreen: INSTRUMENT.success,
  brightYellow: INSTRUMENT.accentHover,
  brightBlue: INSTRUMENT.info,
  brightMagenta: INSTRUMENT.accentHover,
  brightCyan: INSTRUMENT.ink,
  brightWhite: INSTRUMENT.ink,
} as const;

/** The mono stack, for the one consumer that cannot read it from CSS: xterm. */
export const TERMINAL_FONT = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
