import type {
  OtaUpdateStateRecord,
  OtaUpdateStateRepositoryPort,
  UpdateState,
} from '@printerops/domain';

export class InMemoryOtaUpdateStateRepository implements OtaUpdateStateRepositoryPort {
  private state: OtaUpdateStateRecord = {
    state: 'IDLE',
    targetVersion: null,
    startedAt: null,
    updatedAt: new Date(),
    errorMessage: null,
    retryCount: 0,
  };

  async get(): Promise<OtaUpdateStateRecord> {
    return { ...this.state };
  }

  async update(patch: Partial<OtaUpdateStateRecord>): Promise<OtaUpdateStateRecord> {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: new Date(),
    };
    return { ...this.state };
  }
}
