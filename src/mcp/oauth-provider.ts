import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { OAuthClientInformationContext, OAuthClientMetadata, OAuthClientProvider, OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from '@modelcontextprotocol/client';
import type { McpOAuthStore } from './oauth-store.js';

export class IslaMcpOAuthProvider implements OAuthClientProvider {
  private authorization: string | undefined;
  private verifier: string | undefined;
  private discovery: OAuthDiscoveryState | undefined;
  private flowState: string | undefined;

  constructor(private readonly redirect: string, private readonly store: McpOAuthStore) {}

  get redirectUrl(): string { return this.redirect; }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Isla',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  async state(): Promise<string> { return this.flowState ??= randomBytes(32).toString('base64url'); }
  async clientInformation(context?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined> {
    if (!context?.issuer) return undefined;
    const value = (await this.store.load()).clients[context.issuer];
    return value as StoredOAuthClientInformation | undefined;
  }
  async saveClientInformation(value: StoredOAuthClientInformation, context?: OAuthClientInformationContext): Promise<void> {
    if (!context?.issuer) throw new Error('MCP_OAUTH_ISSUER_REQUIRED');
    await this.store.update(state => ({ ...state, clients: { ...state.clients, [context.issuer!]: value } }));
  }
  async tokens(context?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    const issuer = context?.issuer ?? (await this.discoveryState())?.authorizationServerMetadata?.issuer;
    if (!issuer) return undefined;
    const state = await this.store.load();
    return state.tokens[issuer] as StoredOAuthTokens | undefined;
  }
  async saveTokens(value: StoredOAuthTokens, context?: OAuthClientInformationContext): Promise<void> {
    if (!context?.issuer) throw new Error('MCP_OAUTH_ISSUER_REQUIRED');
    await this.store.update(state => ({ ...state, tokens: { ...state.tokens, [context.issuer!]: value } }));
  }
  async redirectToAuthorization(url: URL): Promise<void> {
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password) throw new Error('MCP_OAUTH_AUTHORIZATION_URL_INVALID');
    this.authorization = url.toString();
  }
  async saveCodeVerifier(value: string): Promise<void> {
    this.verifier = value;
    await this.store.update(state => ({ ...state, codeVerifier: value }));
  }
  async codeVerifier(): Promise<string> {
    const value = this.verifier ?? (await this.store.load()).codeVerifier;
    if (!value) throw new Error('MCP_OAUTH_VERIFIER_UNAVAILABLE');
    return value;
  }
  async saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> {
    this.discovery = value;
    await this.store.update(state => ({ ...state, discoveryState: value }));
  }
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    if (this.discovery) return this.discovery;
    const value = (await this.store.load()).discoveryState;
    return value as OAuthDiscoveryState | undefined;
  }

  authorizationUrl(): string | undefined { return this.authorization; }
  validateCallback(params: URLSearchParams): void {
    const received = params.get('state');
    const expected = this.flowState;
    if (!received || !expected) throw new Error('MCP_OAUTH_STATE_INVALID');
    const receivedBytes = Buffer.from(received);
    const expectedBytes = Buffer.from(expected);
    if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) throw new Error('MCP_OAUTH_STATE_INVALID');
  }
  async clearAuthorization(): Promise<void> {
    this.authorization = undefined;
    this.flowState = undefined;
    this.verifier = undefined;
    this.discovery = undefined;
    await this.store.update(state => { const { codeVerifier: _codeVerifier, ...persisted } = state; return persisted; });
  }
}
