import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  assertSafeBindConfig,
  readConfig,
  type PrintOpsMcpConfig,
} from './config.js';
import { PrintOpsApiClient } from './printops-client.js';
import { registerPrintOpsTools, type PrintOpsToolClient } from './tools.js';

const MCP_PATH = '/mcp';
const MCP_METHODS = new Set(['POST', 'GET', 'DELETE']);

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'POST, GET, DELETE, OPTIONS');
  response.setHeader(
    'access-control-allow-headers',
    'content-type, mcp-session-id, last-event-id, authorization, x-mcp-token',
  );
  response.setHeader('access-control-expose-headers', 'Mcp-Session-Id');
}

function authorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const bearer = request.headers.authorization;
  const supplied = request.headers['x-mcp-token'];
  return bearer === `Bearer ${token}` || supplied === token;
}

function writeText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

export function createMcpServer(
  config: PrintOpsMcpConfig,
  client: PrintOpsToolClient = new PrintOpsApiClient(config),
): McpServer {
  const server = new McpServer(
    {
      name: 'printops-datamax',
      version: '0.1.0',
    },
    {
      instructions:
        'PrintOps tools control authenticated printers. Read printer state first. Real Datamax printing requires explicit confirm=true and exactly three numeric values for one 3-up row.',
    },
  );
  registerPrintOpsTools(server, client, config);
  return server;
}

export function createHttpMcpServer(
  config: PrintOpsMcpConfig,
  client: PrintOpsToolClient = new PrintOpsApiClient(config),
): Server {
  assertSafeBindConfig(config);

  return createHttpServer(async (request, response) => {
    if (!request.url) {
      writeText(response, 400, 'Missing URL');
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname === MCP_PATH) {
      setCorsHeaders(response);
    }

    if (request.method === 'OPTIONS' && url.pathname === MCP_PATH) {
      response.writeHead(204);
      response.end();
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') &&
        (url.pathname === '/' || url.pathname === '/health')) {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('PrintOps MCP server');
      return;
    }

    if (url.pathname === MCP_PATH && request.method && MCP_METHODS.has(request.method)) {
      if (!authorized(request, config.mcpToken)) {
        writeText(response, 401, 'Unauthorized');
        return;
      }

      const server = createMcpServer(config, client);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      response.on('close', () => {
        void transport.close();
        void server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(request, response);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown MCP error';
        console.error(`[printops-mcp] MCP request failed: ${message.slice(0, 300)}`);
        if (!response.headersSent) writeText(response, 500, 'Internal server error');
      }
      return;
    }

    writeText(response, 404, 'Not Found');
  });
}

export async function startServer(
  config: PrintOpsMcpConfig = readConfig(),
  client: PrintOpsToolClient = new PrintOpsApiClient(config),
): Promise<Server> {
  const server = createHttpMcpServer(config, client);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, config.host);
  });
  console.log(`PrintOps MCP listening on http://${config.host}:${config.port}${MCP_PATH}`);
  return server;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (entrypoint) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'server startup failed';
    console.error(`[printops-mcp] ${message}`);
    process.exitCode = 1;
  });
}
