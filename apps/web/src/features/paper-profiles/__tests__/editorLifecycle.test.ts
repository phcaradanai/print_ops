// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollPaperProfileEditorIntoView } from '../hooks/usePaperProfileEditor.js';
import {
  createPaperProfileRequestGenerations,
  isCurrentAnalysisGeneration,
  isCurrentArtworkGeneration,
  nextAnalysisGeneration,
  nextArtworkGeneration,
} from '../model/requestGenerations.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Paper Profile editor navigation', () => {
  it('scrolls the app shell rather than the non-scrolling window', () => {
    document.body.innerHTML = '<main class="app-main"></main>';
    const shell = document.querySelector<HTMLElement>('.app-main');
    expect(shell).not.toBeNull();
    const shellScroll = vi.fn();
    Object.defineProperty(shell!, 'scrollTo', { configurable: true, value: shellScroll });
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    scrollPaperProfileEditorIntoView();

    expect(shellScroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(windowScroll).not.toHaveBeenCalled();
  });
});

describe('Paper Profile request generations', () => {
  it('invalidates import analysis without cancelling persisted-artwork loading', () => {
    const generations = createPaperProfileRequestGenerations();
    const artworkGeneration = nextArtworkGeneration(generations);
    const analysisGeneration = nextAnalysisGeneration(generations);

    expect(isCurrentArtworkGeneration(generations, artworkGeneration)).toBe(true);
    expect(isCurrentAnalysisGeneration(generations, analysisGeneration)).toBe(true);

    nextAnalysisGeneration(generations);

    expect(isCurrentArtworkGeneration(generations, artworkGeneration)).toBe(true);
    expect(isCurrentAnalysisGeneration(generations, analysisGeneration)).toBe(false);
  });

  it('invalidates artwork loading independently from active import analysis', () => {
    const generations = createPaperProfileRequestGenerations();
    const analysisGeneration = nextAnalysisGeneration(generations);
    const artworkGeneration = nextArtworkGeneration(generations);

    nextArtworkGeneration(generations);

    expect(isCurrentAnalysisGeneration(generations, analysisGeneration)).toBe(true);
    expect(isCurrentArtworkGeneration(generations, artworkGeneration)).toBe(false);
  });
});
