import { apiFetch } from '../../../api/client.js';
import type {
  ArtworkData,
  ImportAnalyzeResult,
  ImportRequestBody,
  ImportResult,
  PaperForm,
  PaperProfile,
} from '../model/types.js';

export type PaperProfilePayload = PaperForm & {
  fields: PaperProfile['fields'];
};

export interface AnalyzeArtworkPayload {
  fileName: string;
  declaredMimeType: string;
  dataBase64: string;
}

export function listPaperProfiles(): Promise<PaperProfile[]> {
  return apiFetch<PaperProfile[]>('/v1/paper-profiles');
}

export function createPaperProfile(payload: PaperProfilePayload): Promise<PaperProfile> {
  return apiFetch<PaperProfile>('/v1/paper-profiles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updatePaperProfile(id: string, payload: PaperProfilePayload): Promise<PaperProfile> {
  return apiFetch<PaperProfile>(`/v1/paper-profiles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deletePaperProfile(id: string): Promise<void> {
  return apiFetch<void>(`/v1/paper-profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function importPaperProfiles(payload: unknown): Promise<{ imported: PaperProfile[]; count: number }> {
  return apiFetch<{ imported: PaperProfile[]; count: number }>('/v1/paper-profiles/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function analyzePaperArtwork(payload: AnalyzeArtworkPayload): Promise<ImportAnalyzeResult> {
  return apiFetch<ImportAnalyzeResult>('/v1/paper-profile-imports/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createPaperProfileFromArtwork(payload: ImportRequestBody): Promise<ImportResult> {
  return apiFetch<ImportResult>('/v1/paper-profile-imports', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getPaperProfileArtwork(id: string): Promise<ArtworkData> {
  return apiFetch<ArtworkData>(`/v1/paper-profiles/${encodeURIComponent(id)}/artwork`);
}
