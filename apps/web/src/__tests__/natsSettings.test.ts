import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors.js';

const { fetchNatsSettingsMock, updateNatsSettingsMock, isTauriAvailableMock, getDesktopNatsSettingsMock, saveDesktopNatsSettingsMock } = vi.hoisted(() => ({
  fetchNatsSettingsMock: vi.fn(),
  updateNatsSettingsMock: vi.fn(),
  isTauriAvailableMock: vi.fn(),
  getDesktopNatsSettingsMock: vi.fn(),
  saveDesktopNatsSettingsMock: vi.fn(),
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    fetchNatsSettings: fetchNatsSettingsMock,
    updateNatsSettings: updateNatsSettingsMock,
  };
});

vi.mock('../tauri.js', async () => {
  const actual = await vi.importActual<typeof import('../tauri.js')>('../tauri.js');
  return {
    ...actual,
    isTauriAvailable: isTauriAvailableMock,
    getNatsSettings: getDesktopNatsSettingsMock,
    saveNatsSettings: saveDesktopNatsSettingsMock,
  };
});

const {
  loadNatsSettings,
  persistNatsSettings,
  resolveNatsSettingsBackend,
} = await import('../natsSettings.js');

const settings = {
  enabled: true,
  url: 'nats://broker.example:4222',
  clientId: 'pharmacy-counter-01',
  subjectPrefix: 'medisync.print.intake',
};
const status = {
  enabled: true,
  state: 'CONNECTING',
  connected: false,
  intakeReady: false,
  callbackPublishReady: false,
  streamReady: false,
  consumerReady: false,
  clientId: 'pharmacy-counter-01',
};

function apiUnreachable(): ApiError {
  return new ApiError({ status: 0, path: '/v1/print-flow/nats-settings', message: 'Network request failed' });
}

beforeEach(() => {
  fetchNatsSettingsMock.mockReset();
  updateNatsSettingsMock.mockReset();
  isTauriAvailableMock.mockReset();
  getDesktopNatsSettingsMock.mockReset();
  saveDesktopNatsSettingsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NATS settings backend resolution', () => {
  // The panel used to be gated on the Tauri bridge, so a Linux server install
  // could not configure NATS at all and was told it was "desktop only".
  it('uses the API whenever the API answers, in any build', async () => {
    fetchNatsSettingsMock.mockResolvedValue({ settings, source: 'file' });
    isTauriAvailableMock.mockResolvedValue(true);

    await expect(resolveNatsSettingsBackend()).resolves.toBe('api');
    expect(isTauriAvailableMock).not.toHaveBeenCalled();
  });

  it('treats an authorisation refusal as an API answer so its message can be shown', async () => {
    fetchNatsSettingsMock.mockRejectedValue(
      new ApiError({ status: 403, path: '/v1/print-flow/nats-settings', message: 'Missing permission: template:read' }),
    );
    isTauriAvailableMock.mockResolvedValue(true);

    await expect(resolveNatsSettingsBackend()).resolves.toBe('api');
  });

  it('falls back to the desktop bridge only when the API cannot answer', async () => {
    fetchNatsSettingsMock.mockRejectedValue(apiUnreachable());
    isTauriAvailableMock.mockResolvedValue(true);

    await expect(resolveNatsSettingsBackend()).resolves.toBe('desktop');

    getDesktopNatsSettingsMock.mockResolvedValue(settings);
    await expect(loadNatsSettings('desktop')).resolves.toEqual({ settings, source: 'file' });

    saveDesktopNatsSettingsMock.mockResolvedValue(undefined);
    await expect(persistNatsSettings('desktop', settings)).resolves.toBeNull();
    expect(saveDesktopNatsSettingsMock).toHaveBeenCalledWith(settings);
  });

  it('reports the panel unavailable when neither the API nor the desktop bridge answers', async () => {
    fetchNatsSettingsMock.mockRejectedValue(apiUnreachable());
    isTauriAvailableMock.mockResolvedValue(false);

    await expect(resolveNatsSettingsBackend()).resolves.toBe('unavailable');
    await expect(loadNatsSettings('unavailable')).resolves.toBeNull();
    await expect(persistNatsSettings('unavailable', settings)).rejects.toThrow(/API did not respond/);
  });
});

describe('NATS settings through the API', () => {
  it('loads the settings and where they came from', async () => {
    fetchNatsSettingsMock.mockResolvedValue({ settings, source: 'env' });

    await expect(loadNatsSettings('api')).resolves.toEqual({ settings, source: 'env' });
  });

  it('ignores a payload that is not a settings view instead of inventing defaults', async () => {
    // An older API or a proxy answering `/nats-settings` with an unrelated body
    // must not render "NATS is disabled with empty fields".
    fetchNatsSettingsMock.mockResolvedValue([]);
    await expect(loadNatsSettings('api')).resolves.toBeNull();
  });

  it('saves and returns the status the API applied so the caller can report it', async () => {
    updateNatsSettingsMock.mockResolvedValue({ settings, source: 'file', status });

    await expect(persistNatsSettings('api', settings)).resolves.toEqual(status);
    expect(updateNatsSettingsMock).toHaveBeenCalledWith(settings);
  });

  it('surfaces the API error text when the save is rejected', async () => {
    updateNatsSettingsMock.mockRejectedValue(
      new ApiError({ status: 400, path: '/v1/print-flow/nats-settings', message: 'NATS URL must start with nats://' }),
    );

    await expect(persistNatsSettings('api', settings)).rejects.toThrow('NATS URL must start with nats://');
  });
});
