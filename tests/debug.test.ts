import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';
describe('debug config', () => {
  it('accepts explicit debug mode without exposing secrets', () => {
    const config = readConfig({ ISLA_PROVIDER: 'local', ISLA_MODEL: 'm', ISLA_BASE_URL: 'http://localhost:1', ISLA_DEBUG: '1' });
    expect(config.debug).toBe(true);
  });
});
