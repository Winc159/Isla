import type { BrowserElementRef, BrowserSessionSnapshot } from './types.js';

export type LoginOutcome =
  | { readonly status: 'authenticated'; readonly confidence: 'high' | 'medium' }
  | { readonly status: 'challenge'; readonly kind: 'otp' | 'captcha' | 'passkey' | 'device' | 'unknown' }
  | { readonly status: 'invalid_credentials' }
  | { readonly status: 'still_on_login' }
  | { readonly status: 'unknown' };

export function detectLoginOutcome(snapshot: BrowserSessionSnapshot, elements: readonly BrowserElementRef[], previous?: LoginOutcome): LoginOutcome {
  const text = elements.map(element => `${element.role} ${element.name ?? ''} ${element.text ?? ''} ${element.inputType ?? ''}`).join(' ').toLowerCase();
  const url = (snapshot.url ?? '').toLowerCase();
  if (/(captcha|recaptcha|hcaptcha|robot|图形验证码)/i.test(text)) return { status: 'challenge', kind: 'captcha' };
  if (/(passkey|webauthn|security key|安全密钥)/i.test(text)) return { status: 'challenge', kind: 'passkey' };
  if (/(approve|device|确认设备|设备确认)/i.test(text)) return { status: 'challenge', kind: 'device' };
  if (/(one[- ]?time|verification code|authentication code|验证码|动态码|otp|totp)/i.test(text)) return { status: 'challenge', kind: 'otp' };
  if (/(invalid|incorrect|wrong password|密码错误|登录失败)/i.test(text)) return { status: 'invalid_credentials' };
  const hasPassword = elements.some(element => element.inputType === 'password');
  const hasLoginAction = /(login|sign in|log in|登录|登陆)/i.test(text);
  const hasAccountSignal = /(dashboard|account|profile|logout|sign out|退出登录|账户|个人资料)/i.test(text);
  if (hasAccountSignal && !hasPassword && !hasLoginAction && !/\/login(?:[/?#]|$)/i.test(url)) return { status: 'authenticated', confidence: 'high' };
  if (hasPassword || hasLoginAction || /\/login(?:[/?#]|$)/i.test(url)) return { status: 'still_on_login' };
  if (previous?.status === 'authenticated') return previous;
  return { status: 'unknown' };
}
