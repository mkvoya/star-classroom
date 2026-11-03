export type IceServer = { urls: string[]; username?: string; credential?: string };
export type TurnEnvironment = { CLOUDFLARE_TURN_KEY_ID?: string; CLOUDFLARE_TURN_API_TOKEN?: string; TURN_TEACHER_PASSPHRASE?: string };
export const TURN_TTL = 600;
export const DIRECT_ICE: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
export function turnConfigured(env: TurnEnvironment) { return Boolean(env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN && env.TURN_TEACHER_PASSPHRASE); }
export function canEnableTurn(env: TurnEnvironment, passphrase: unknown) { return turnConfigured(env) && typeof passphrase === 'string' && passphrase.length > 0 && passphrase === env.TURN_TEACHER_PASSPHRASE; }
export function normalizeIceServers(value: unknown): IceServer[] {
  if (!value || typeof value !== 'object' || !('iceServers' in value) || !Array.isArray(value.iceServers)) throw new Error('Invalid TURN response');
  const servers: IceServer[] = [];
  for (const server of value.iceServers) {
    if (!server || typeof server !== 'object') continue;
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url: unknown): url is string => typeof url === 'string' && /^(stun|turn|turns):(?:stun|turn)\.cloudflare\.com:(3478|443|80|5349)(?:\?transport=(?:udp|tcp))?$/.test(url));
    if (!urls.length) continue;
    const relay = urls.some((url: string) => /^turns?:/.test(url));
    if (relay && (typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential)) continue;
    servers.push({ urls, ...(relay ? { username: server.username, credential: server.credential } : {}) });
  }
  if (!servers.some(server => server.urls.some(url => /^turns?:/.test(url)))) throw new Error('No usable TURN servers');
  return servers;
}
export async function issueTurn(env: TurnEnvironment, fetcher: typeof fetch = fetch) {
  if (!turnConfigured(env)) throw new Error('TURN is not configured');
  const response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID!)}/credentials/generate-ice-servers`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'classroom-turn-integration/1.0' },
    body: JSON.stringify({ ttl: TURN_TTL }), signal: AbortSignal.timeout(8000),
  });
  // Never relay provider error bodies or the master API token to the browser/logs.
  if (!response.ok) throw new Error('TURN provider unavailable');
  return normalizeIceServers(await response.json());
}
