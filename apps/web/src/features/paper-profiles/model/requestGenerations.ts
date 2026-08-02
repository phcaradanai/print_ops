export interface PaperProfileRequestGenerations {
  analysis: number;
  artwork: number;
}

export function createPaperProfileRequestGenerations(): PaperProfileRequestGenerations {
  return { analysis: 0, artwork: 0 };
}

export function nextAnalysisGeneration(state: PaperProfileRequestGenerations): number {
  state.analysis += 1;
  return state.analysis;
}

export function nextArtworkGeneration(state: PaperProfileRequestGenerations): number {
  state.artwork += 1;
  return state.artwork;
}

export function isCurrentAnalysisGeneration(state: PaperProfileRequestGenerations, generation: number): boolean {
  return state.analysis === generation;
}

export function isCurrentArtworkGeneration(state: PaperProfileRequestGenerations, generation: number): boolean {
  return state.artwork === generation;
}
