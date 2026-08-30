/**
 * Layout tree — pure operations on the split tree that arranges panes.
 *
 * Ported from Chorus unchanged in spirit: the tree supports arbitrary nesting
 * even though the templates only produce two levels, because the divider-drag
 * and pane-close paths need to collapse and rebalance generically.
 */
import type { LayoutNode } from './models.js';

export type TemplateName = '1' | '1x2' | '1x3' | '2x2' | '3+2' | '2x3';

export const TEMPLATES: { name: TemplateName; label: string; panes: number }[] = [
  { name: '1', label: '1', panes: 1 },
  { name: '1x2', label: '1×2', panes: 2 },
  { name: '1x3', label: '1×3', panes: 3 },
  { name: '2x2', label: '2×2', panes: 4 },
  { name: '3+2', label: '3+2', panes: 5 },
  { name: '2x3', label: '2×3', panes: 6 },
];

/** The template that gives exactly `n` panes, for the Terminals dropdown. */
export function templateForCount(n: number): TemplateName {
  return TEMPLATES.find((t) => t.panes === n)?.name ?? '1';
}

const leaf = (): LayoutNode => ({ type: 'leaf', sessionId: null });
const even = (n: number) => Array.from({ length: n }, () => 1 / n);

function row(children: LayoutNode[]): LayoutNode {
  return { type: 'split', dir: 'row', sizes: even(children.length), children };
}
function col(children: LayoutNode[]): LayoutNode {
  return { type: 'split', dir: 'col', sizes: even(children.length), children };
}

/** Build an empty layout for a template. */
export function templateLayout(name: TemplateName): LayoutNode {
  switch (name) {
    case '1':
      return leaf();
    case '1x2':
      return row([leaf(), leaf()]);
    case '1x3':
      return row([leaf(), leaf(), leaf()]);
    case '2x2':
      return col([row([leaf(), leaf()]), row([leaf(), leaf()])]);
    case '3+2':
      // Five panes: a row of three over a row of two. Uneven by necessity —
      // five does not factor into a rectangle.
      return col([row([leaf(), leaf(), leaf()]), row([leaf(), leaf()])]);
    case '2x3':
      return col([row([leaf(), leaf(), leaf()]), row([leaf(), leaf(), leaf()])]);
  }
}

/** Every leaf, left-to-right / top-to-bottom — the pane order the UI renders. */
export function collectLeaves(node: LayoutNode): (string | null)[] {
  if (node.type === 'leaf') return [node.sessionId];
  return node.children.flatMap(collectLeaves);
}

/** Index of the first empty leaf, or -1. Where a new pane lands. */
export function firstEmptyLeafIndex(node: LayoutNode): number {
  return collectLeaves(node).findIndex((id) => id === null);
}

/** Set the nth leaf's session id (n counted over all leaves). */
export function setLeafAt(node: LayoutNode, index: number, sessionId: string | null): LayoutNode {
  let seen = -1;
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.type === 'leaf') {
      seen += 1;
      return seen === index ? { type: 'leaf', sessionId } : n;
    }
    return { ...n, children: n.children.map(walk) };
  };
  return walk(node);
}

/**
 * Build the layout for exactly these panes, in order.
 *
 * Used when the pane count changes — closing a pane RESHAPES the grid rather
 * than leaving a hole where the terminal was. An empty slot left behind reads
 * as "something is still here", and the Terminals count would disagree with
 * what is on screen.
 *
 * Clamped to one leaf: with no panes left you still need a slot to launch from.
 */
export function layoutForSessions(sessionIds: string[]): LayoutNode {
  let layout = templateLayout(templateForCount(Math.max(1, sessionIds.length)));
  sessionIds.forEach((id, i) => {
    layout = setLeafAt(layout, i, id);
  });
  return layout;
}

/**
 * Replace a split's sizes after a divider drag. `path` is the child-index route
 * from the root; sizes are fractions that must sum to 1.
 */
export function resizeSplit(node: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (path.length === 0) {
    if (node.type !== 'split') return node;
    return { ...node, sizes };
  }
  if (node.type !== 'split') return node;
  const [head, ...rest] = path;
  return {
    ...node,
    children: node.children.map((c, i) => (i === head ? resizeSplit(c, rest, sizes) : c)),
  };
}

/** Total leaf count — the pane capacity of a layout. */
export function leafCount(node: LayoutNode): number {
  return collectLeaves(node).length;
}
