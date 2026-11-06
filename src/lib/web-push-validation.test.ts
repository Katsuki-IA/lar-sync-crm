import { describe, it, expect } from 'vitest';
import { validEndpoint, validKeys, ORIGINS } from '../../supabase/functions/hub-web-push/validation';

describe('push destinations', () => {
  it('accepts supported browser providers', () => {
    for (const host of ['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com'])
      expect(validEndpoint(`https://${host}/token`)).toBe(true);
  });
  it('rejects internal, spoofed, credentialed and redirected destinations', () => {
    for (const url of ['http://fcm.googleapis.com/token', 'https://127.0.0.1/token', 'https://fcm.googleapis.com.attacker.com/token', 'https://web.push.apple.com@attacker.com/token', 'https://web.push.apple.com:8443/token', 'https://attacker.com/token', 'https://web.push.apple.com/token#fragment'])
      expect(validEndpoint(url)).toBe(false);
  });
  it('requires valid subscription keys and explicit app origins', () => {
    expect(validKeys('A'.repeat(87), 'B'.repeat(22))).toBe(true);
    expect(validKeys('A'.repeat(87)+'=', 'B'.repeat(22)+'==')).toBe(true);
    expect(validKeys('short', 'short')).toBe(false);
    expect(ORIGINS.has('https://hub.katsuki.com.br.attacker.com')).toBe(false);
  });
});
