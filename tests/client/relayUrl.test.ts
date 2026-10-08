import { describe, expect, it } from 'vitest';
import { defaultRelayUrl } from '../../client/src/lobby';

const at = (href: string) => new URL(href) as unknown as Location;

describe('defaultRelayUrl', () => {
  it('dev dials the separate relay on :8787', () => {
    expect(defaultRelayUrl(at('http://localhost:5173/'), {})).toBe('ws://localhost:8787');
  });
  it('a hosted build dials its own origin, wss under https', () => {
    expect(defaultRelayUrl(at('https://openbattles.onrender.com/'), { PROD: true })).toBe('wss://openbattles.onrender.com/relay');
    expect(defaultRelayUrl(at('http://192.168.1.5:8787/'), { PROD: true })).toBe('ws://192.168.1.5:8787/relay');
  });
  it('?relay= beats VITE_RELAY_URL beats same-origin', () => {
    const env = { PROD: true, VITE_RELAY_URL: 'wss://relay.example/relay' };
    expect(defaultRelayUrl(at('https://a.example/'), env)).toBe('wss://relay.example/relay');
    expect(defaultRelayUrl(at('https://a.example/?relay=ws://x:1'), env)).toBe('ws://x:1');
  });
});
