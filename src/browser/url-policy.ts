import { isIP } from 'node:net';

export function validateBrowserUrl(input: string, options: { readonly allowLoopback?: boolean } = {}): URL {
  if (input.length === 0 || input.length > 2048) throw new Error('BROWSER_URL_INVALID');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('BROWSER_URL_INVALID'); }
  if (url.protocol !== 'https:' && !(options.allowLoopback === true && url.protocol === 'http:')) throw new Error('BROWSER_URL_SCHEME_FORBIDDEN');
  if (url.username || url.password || url.search || url.hash) { url.username = ''; url.password = ''; }
  const host = url.hostname.toLowerCase();
  const privateHost = host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.') || host.startsWith('172.16.') || host.startsWith('172.17.') || host.startsWith('172.18.') || host.startsWith('172.19.') || host.startsWith('172.2') || host.startsWith('172.30.') || host.startsWith('172.31.');
  if (isIP(host) !== 0 && privateHost && options.allowLoopback !== true) throw new Error('BROWSER_PRIVATE_NETWORK_FORBIDDEN');
  if (host === 'localhost' && options.allowLoopback !== true) throw new Error('BROWSER_PRIVATE_NETWORK_FORBIDDEN');
  return url;
}
