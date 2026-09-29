import { createServer } from 'node:net';

export interface BrowserConsolePortOptions {
  readonly port?: number;
  readonly host?: string;
}

/** Reserves a loopback port, or validates an explicitly configured one. */
export async function reserveBrowserConsolePort(options: BrowserConsolePortOptions = {}): Promise<{ readonly host: string; readonly port: number; release(): Promise<void> }> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('Browser Console must bind to loopback');
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Browser Console port must be between 0 and 65535');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port }, () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { await close(server); throw new Error('Unable to determine Browser Console port'); }
  return { host, port: address.port, release: () => close(server) };
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}
