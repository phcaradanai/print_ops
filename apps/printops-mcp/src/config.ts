export const DEFAULT_API_URL = 'http://127.0.0.1:31415';
export const DEFAULT_MCP_HOST = '127.0.0.1';
export const DEFAULT_MCP_PORT = 31888;

export const DEFAULT_DATAMAX_PRINTER_CODE = 'DATAMAXONEIL_I4208';
export const DEFAULT_DATAMAX_TEMPLATE_CODE = 'DMX_I4208_3UP_NATIVE_DPL_20260902';
export const DEFAULT_DATAMAX_PAPER_PROFILE_ID = 'e6f3d58b-04db-4e21-b1c7-91182072ca4b';

export interface PrintOpsMcpConfig {
  apiUrl: string;
  apiKey?: string;
  jwt?: string;
  mcpToken?: string;
  host: string;
  port: number;
  datamaxPrinterCode: string;
  datamaxTemplateCode: string;
  datamaxPaperProfileId: string;
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function portValue(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_MCP_PORT;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PRINTOPS_MCP_PORT must be an integer between 1 and 65535');
  }
  return port;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): PrintOpsMcpConfig {
  return {
    apiUrl: optionalValue(env.PRINTOPS_API_URL) ?? DEFAULT_API_URL,
    apiKey: optionalValue(env.PRINTOPS_API_KEY),
    jwt: optionalValue(env.PRINTOPS_JWT),
    mcpToken: optionalValue(env.PRINTOPS_MCP_TOKEN),
    host: optionalValue(env.PRINTOPS_MCP_HOST) ?? DEFAULT_MCP_HOST,
    port: portValue(env.PRINTOPS_MCP_PORT),
    datamaxPrinterCode:
      optionalValue(env.PRINTOPS_DATAMAX_PRINTER_CODE) ?? DEFAULT_DATAMAX_PRINTER_CODE,
    datamaxTemplateCode:
      optionalValue(env.PRINTOPS_DATAMAX_TEMPLATE_CODE) ?? DEFAULT_DATAMAX_TEMPLATE_CODE,
    datamaxPaperProfileId:
      optionalValue(env.PRINTOPS_DATAMAX_PAPER_PROFILE_ID) ?? DEFAULT_DATAMAX_PAPER_PROFILE_ID,
  };
}

export function assertSafeBindConfig(config: PrintOpsMcpConfig): void {
  const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
  if (!loopbackHosts.has(config.host) && !config.mcpToken) {
    throw new Error('PRINTOPS_MCP_TOKEN is required when PRINTOPS_MCP_HOST is not loopback');
  }
}
