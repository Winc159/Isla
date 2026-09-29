import { describe, expect, it } from 'vitest';
import { detectLoginOutcome } from '../src/browser/login-outcome.js';

const snapshot = (url: string) => ({ id: 's', status: 'agent_control' as const, url });
const field = (name: string, inputType?: string, text?: string) => ({ ref: name, role: 'textbox', name, inputType, text });

describe('login outcome detector', () => {
  it('recognizes authenticated account pages', () => {
    expect(detectLoginOutcome(snapshot('https://github.com/'), [field('Dashboard', undefined, 'Dashboard'), field('Winc159', undefined, 'Account menu')])).toEqual({ status: 'authenticated', confidence: 'high' });
  });
  it('stops at OTP and captcha challenges', () => {
    expect(detectLoginOutcome(snapshot('https://example.com/login'), [field('verification code', 'text')])).toEqual({ status: 'challenge', kind: 'otp' });
    expect(detectLoginOutcome(snapshot('https://example.com/login'), [field('captcha', 'text')])).toEqual({ status: 'challenge', kind: 'captcha' });
  });
  it('does not treat a changed URL alone as successful login', () => {
    expect(detectLoginOutcome(snapshot('https://example.com/home'), [field('password', 'password'), field('Sign in', undefined, 'Sign in')])).toEqual({ status: 'still_on_login' });
  });
});
