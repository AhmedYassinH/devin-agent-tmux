/**
 * The guide popup.
 *
 * Written against what this app actually does, not what its Claude-Code
 * ancestor did — every claim here was verified against the running CLI. Where a
 * behaviour has a constraint behind it (why a locked session can't be traced,
 * why the context figure is an estimate, why resuming makes its own workspace)
 * the guide says so, because those are exactly the places a user would
 * otherwise assume a bug.
 *
 * Rendered as ribbon cards — white title bar, tinted body — cycling the eight
 * catalog tints, which is the design language's signature component.
 */
import { useEffect, type ReactNode } from 'react';
import { TINTS } from './theme.js';

interface Section {
  icon: string;
  title: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    icon: '▤',
    title: 'Workspaces',
    body: (
      <>
        A workspace is a named group of Devin sessions with its own layout and a default working
        directory. Add one with <b>+ New workspace</b>, rename with <b>✎</b> (or double-click), and
        remove with <b>✕</b>. Point it at a project directory — Devin scopes its sessions by
        directory and warns when run from your home folder.
      </>
    ),
  },
  {
    icon: '⊞',
    title: 'Terminals & layout',
    body: (
      <>
        Pick <b>1–6</b> from the <b>Terminals</b> dropdown. Drag the dividers to resize; the
        terminals reflow. <b>↺ Reset</b> re-evens the splits without touching the running
        processes. Closing a pane with <b>✕</b> shrinks the grid — the slot goes away rather than
        leaving an empty launcher behind.
      </>
    ),
  },
  {
    icon: '▶',
    title: 'Run an agent',
    body: (
      <>
        In an empty pane, optionally name it, confirm the working directory, and hit{' '}
        <b>Run Devin</b> (or <b>Shell</b> for a plain terminal). Each pane is the <i>real</i>{' '}
        <code>devin</code> TUI, so everything works as it does in your terminal: slash commands,{' '}
        <code>/model</code> to switch model, <code>Shift+Tab</code> to cycle the permission mode.
        Panes start with edits auto-approved.
      </>
    ),
  },
  {
    icon: '●',
    title: 'Status & attention',
    body: (
      <>
        Every pane and sidebar row carries a live badge — <b>idle</b>, <b>running</b>,{' '}
        <b>waiting</b>, <b>exited</b> — driven by Devin's own lifecycle hooks, not by guessing at
        terminal output. When an agent needs you, it gets a yellow <b>Needs you!</b> tag, its
        workspace gets a marker, and the count appears in red at the top right. That's the point of
        running six at once: you work by exception instead of watching panes.
      </>
    ),
  },
  {
    icon: '↺',
    title: 'Resume a past session',
    body: (
      <>
        <b>Sessions…</b> lists every Devin conversation on this machine. <b>Resume</b> relaunches
        one with <code>devin -r</code> in <b>its own new workspace</b>, at the directory it
        originally ran in — that flag only works from there. Sessions marked <b>locked</b> are open
        in a running process; Devin allows one holder at a time.
      </>
    ),
  },
  {
    icon: '⟐',
    title: 'Trace a session',
    body: (
      <>
        <b>Trace</b> replays a conversation turn by turn: prompts, replies, thinking, and every tool
        call paired with its result, duration and file diff. It reads Devin's own record over ACP,
        so nothing is reconstructed or copied. Live panes can't be traced while they run — the same
        one-holder lock — so trace a session once its pane is closed.
      </>
    ),
  },
  {
    icon: '◑',
    title: 'Context health',
    body: (
      <>
        The <b>%</b> chip estimates how full a pane's context window is: green, amber past 50%, red
        past 70%, where quality starts degrading well before the hard limit. It's an{' '}
        <i>estimate</i> — Devin reports cumulative token totals, so the figure is derived from
        per-turn deltas. Hover it for the exact counts and the model's real window.
      </>
    ),
  },
  {
    icon: '▣',
    title: 'Where your state lives',
    body: (
      <>
        Workspaces, layouts and sessions are saved to <code>~/.devin-agent-tmux/</code> as one
        readable JSON file per entity — <code>cat</code> it, diff it, back it up. Everything runs on
        this machine: your agents, your code, your Devin credentials. Nothing is uploaded unless you
        configure the optional Convex mirror.
      </>
    ),
  },
];

export function Guide({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Guide">
        <header>
          <h2>The Guide</h2>
          <button className="ghost" onClick={onClose} aria-label="Close guide">
            ✕
          </button>
        </header>

        <p className="guide-lede">
          Run many Devin CLI agents in parallel, in your browser. Each pane is the real{' '}
          <code>devin</code> terminal — this app arranges them, watches them, and remembers them.
        </p>

        {SECTIONS.map((section, i) => (
          <section className="guide-card" key={section.title}>
            <div className="guide-card-title">
              <span className="guide-icon" aria-hidden="true">
                {section.icon}
              </span>
              {section.title}
            </div>
            {/* Cycle the catalog tints, one per card, as the product lines did */}
            <div className={`guide-card-body tint-${TINTS[i % TINTS.length]}`}>{section.body}</div>
          </section>
        ))}

        <footer className="card-actions">
          <button className="primary" onClick={onClose}>
            Start building
          </button>
        </footer>
      </div>
    </div>
  );
}
