/**
 * Dell-1996 design tokens, in code.
 *
 * The palette is CLOSED by design: eight catalog tints, Dell red, Dell yellow,
 * classic link blue, black and white. Nothing else. Anything that needs to
 * signal state picks from the tint family rather than inventing a colour —
 * which is why `exited` is salmon and not brand red: red is reserved for the
 * single CTA panel, the phone callout and the award seal.
 */

/** The eight ribbon-card tints, in catalog order. */
export const TINTS = [
  'sage',
  'salmon',
  'periwinkle',
  'sky',
  'peach',
  'lime',
  'steel',
  'olive',
] as const;

export type Tint = (typeof TINTS)[number];

/**
 * Assign a pane its catalog tint by position, the way each Dell product line
 * owned one colour. Position rather than a hash of the id: adjacent panes then
 * always differ, which is the whole point of the device.
 */
export function tintForIndex(index: number): Tint {
  return TINTS[((index % TINTS.length) + TINTS.length) % TINTS.length] ?? 'sage';
}

/**
 * xterm palette: the terminal is the ribbon card's *product photograph*, and in
 * 1996 those were beveled CRT monitors — so it stays a dark screen inside a hard
 * black bevel, sitting on the tinted card body. Making it white would flatten
 * the card's three-layer structure and wreck contrast for Devin's TUI, which
 * draws light-on-dark.
 */
export const TERMINAL_THEME = {
  background: '#000000',
  foreground: '#dcdcdc',
  cursor: '#fcc20f',
  selectionBackground: '#6a26a4',
  black: '#000000',
  red: '#e91d2a',
  green: '#c0d4a7',
  yellow: '#fcc20f',
  blue: '#8c9ae0',
  magenta: '#6a26a4',
  cyan: '#9ab6c8',
  white: '#dcdcdc',
} as const;
