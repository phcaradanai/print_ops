export type RunnerStatus = 'online' | 'offline' | 'busy' | 'draining';
export interface Runner {
    id: string;
    name: string;
    hostname: string;
    ipAddress?: string;
    status: RunnerStatus;
    supportedProtocols: string[];
    lastHeartbeatAt?: Date;
    registeredAt: Date;
    metadata: Record<string, unknown>;
}
export type RegisterRunnerInput = Pick<Runner, 'name' | 'hostname' | 'supportedProtocols' | 'metadata'> & {
    ipAddress?: string;
};
//# sourceMappingURL=runner.d.ts.map