import { describe, expect, it } from 'vitest';
import { clearSession, collectLeaves, firstEmptyLeafIndex, leafCount, setLeafAt, templateForCount, templateLayout } from './layout.js';

describe('templateLayout', () => {
  it('produces the advertised pane counts', () => {
    expect(leafCount(templateLayout('1'))).toBe(1);
    expect(leafCount(templateLayout('1x3'))).toBe(3);
    expect(leafCount(templateLayout('2x3'))).toBe(6);
    expect(leafCount(templateLayout('3+2'))).toBe(5);
  });

  it('maps every dropdown count 1-6 to a template of that size', () => {
    for (let n = 1; n <= 6; n += 1) {
      expect(leafCount(templateLayout(templateForCount(n)))).toBe(n);
    }
  });
});

describe('leaf placement', () => {
  it('seats a pane in the first free slot', () => {
    let l = templateLayout('1x2');
    expect(firstEmptyLeafIndex(l)).toBe(0);
    l = setLeafAt(l, 0, 'a');
    expect(firstEmptyLeafIndex(l)).toBe(1);
    expect(collectLeaves(l)).toEqual(['a', null]);
  });

  it('keeps the grid shape when a pane closes', () => {
    let l = setLeafAt(setLeafAt(templateLayout('1x2'), 0, 'a'), 1, 'b');
    l = clearSession(l, 'a');
    expect(collectLeaves(l)).toEqual([null, 'b']);
    expect(leafCount(l)).toBe(2);
  });

  it('walks nested splits', () => {
    let l = templateLayout('2x2');
    l = setLeafAt(l, 3, 'd');
    expect(collectLeaves(l)).toEqual([null, null, null, 'd']);
  });
});
