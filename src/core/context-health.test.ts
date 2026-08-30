import { describe, expect, it } from 'vitest';
import { computeHealth, contextWindowFor, estimateOccupancy, parseExport, type ExportMetrics } from './context-health.js';

const m = (totalPromptTokens: number, inferenceSteps: number, model?: string): ExportMetrics => ({
  totalPromptTokens,
  totalCompletionTokens: 0,
  totalCachedTokens: 0,
  totalSteps: 0,
  inferenceSteps,
  model,
});

describe('estimateOccupancy', () => {
  it('is exact for a single-turn session with no baseline', () => {
    expect(estimateOccupancy(m(19287, 1))).toBe(19287);
  });

  it('differentiates rather than summing across turns', () => {
    // Two requests of ~30k each: the window holds ~30k, not the 60k total.
    expect(estimateOccupancy(m(60000, 2), m(30000, 1))).toBe(30000);
  });

  it('falls back to the cumulative mean when no new inference ran', () => {
    expect(estimateOccupancy(m(60000, 2), m(60000, 2))).toBe(30000);
  });

  it('drops after a compaction rather than latching high', () => {
    // A running maximum would pin the badge red here; the delta does not.
    const before = m(200000, 4);
    const after = m(210000, 5); // one small post-compaction request
    expect(estimateOccupancy(after, before)).toBe(10000);
  });
});

describe('contextWindowFor', () => {
  it('resolves families across effort/priority suffixes', () => {
    expect(contextWindowFor('claude-opus-4-8-high-fast')).toBe(1_000_000);
    expect(contextWindowFor('claude-opus-4-8-xhigh')).toBe(1_000_000);
  });
  it('handles devin non-anthropic models', () => {
    expect(contextWindowFor('gpt-5-3-codex-high')).toBe(400_000);
    expect(contextWindowFor('gemini-3-1-pro-low')).toBe(1_000_000);
  });
  it('assumes the conservative window when unknown', () => {
    expect(contextWindowFor('some-future-model')).toBe(200_000);
    expect(contextWindowFor(undefined)).toBe(200_000);
  });
});

describe('computeHealth', () => {
  it('tiers on the fraction, not a token count', () => {
    expect(computeHealth(m(150_000, 1, 'claude-haiku-4-5')).tier).toBe('handoff');
    expect(computeHealth(m(150_000, 1, 'claude-opus-4-8')).tier).toBe('healthy');
  });
  it('clamps past a full window', () => {
    expect(computeHealth(m(999_999_999, 1, 'claude-haiku-4-5')).pct).toBe(1);
  });
});

describe('parseExport', () => {
  it('reads the real export shape', () => {
    const parsed = parseExport({
      schema_version: '9',
      agent: { model_name: 'Claude Opus 4.8 High Fast' },
      steps: [
        { step_id: 1, source: 'system', extra: {} },
        { step_id: 2, source: 'agent', extra: { generation_model: 'claude-opus-4-8-high-fast' } },
      ],
      final_metrics: { total_prompt_tokens: 19287, total_completion_tokens: 41, total_cached_tokens: 0, total_steps: 8 },
    });
    expect(parsed).toMatchObject({ totalPromptTokens: 19287, inferenceSteps: 1, model: 'claude-opus-4-8-high-fast' });
  });

  it('degrades to null on a shape it cannot read', () => {
    expect(parseExport('nope')).toBeNull();
  });
});
