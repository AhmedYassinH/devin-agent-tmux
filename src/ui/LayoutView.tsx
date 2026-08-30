/**
 * Renders the layout tree as nested flex splits with draggable dividers.
 *
 * Panes are rendered by the caller and passed in by id, so this file owns
 * geometry only — the same pane element is reused across a resize, which is what
 * keeps the terminal (and its PTY) alive through a divider drag.
 */
import { useRef, type ReactNode } from 'react';
import type { LayoutNode } from '../core/models.js';

export function LayoutView({
  node,
  path = [],
  renderPane,
  onResize,
}: {
  node: LayoutNode;
  path?: number[];
  renderPane: (sessionId: string | null, key: string) => ReactNode;
  onResize: (path: number[], sizes: number[]) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  if (node.type === 'leaf') {
    return <div className="pane-slot">{renderPane(node.sessionId, path.join('-'))}</div>;
  }

  const horizontal = node.dir === 'row';

  const startDrag = (index: number, event: React.PointerEvent) => {
    event.preventDefault();
    const container = ref.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const total = horizontal ? rect.width : rect.height;
    const startPos = horizontal ? event.clientX : event.clientY;
    const startSizes = [...node.sizes];

    const move = (e: PointerEvent) => {
      const delta = ((horizontal ? e.clientX : e.clientY) - startPos) / total;
      const a = startSizes[index] ?? 0;
      const b = startSizes[index + 1] ?? 0;
      // Clamp so neither neighbour can be squeezed below a usable width; a
      // zero-size terminal reflows its PTY to nonsense dimensions.
      const min = 0.1;
      const shift = Math.max(-a + min, Math.min(b - min, delta));
      const next = [...startSizes];
      next[index] = a + shift;
      next[index + 1] = b - shift;
      onResize(path, next);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className={`split split-${node.dir}`}>
      {node.children.map((child, i) => (
        <div key={i} className="split-child" style={{ flexGrow: node.sizes[i] ?? 1, flexBasis: 0 }}>
          <LayoutView node={child} path={[...path, i]} renderPane={renderPane} onResize={onResize} />
          {i < node.children.length - 1 && (
            <div
              className={`divider divider-${node.dir}`}
              onPointerDown={(e) => startDrag(i, e)}
              role="separator"
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
            />
          )}
        </div>
      ))}
    </div>
  );
}
