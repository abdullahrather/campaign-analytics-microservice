/**
 * src/lib/redis.ts
 *
 * The Redis connection and its atomic scripts. Each script runs as one step, so
 * checks and updates can't interleave however many requests arrive at once.
 */
import { Redis } from 'ioredis';
import { env } from '@/config/env';

const ENQUEUE_EVENTS = `
local accepted = {}
for index = 2, #ARGV, 3 do
  local eventId, campaignId, payload = ARGV[index], ARGV[index + 1], ARGV[index + 2]
  if redis.call('SET', 'seen:' .. eventId, '1', 'NX', 'EX', ARGV[1]) then
    accepted[#accepted + 1] = payload
    if campaignId ~= '' then redis.call('INCR', 'delivered:' .. campaignId) end
  end
end
if #accepted > 0 then
  redis.call('XADD', KEYS[1], '*', 'events', '[' .. table.concat(accepted, ',') .. ']')
end
return #accepted
`;

const RESERVE_AD = `
local delivered = tonumber(redis.call('GET', KEYS[2]) or '0')
local served = tonumber(redis.call('GET', KEYS[1]) or '0')
local current = math.max(served, delivered)
if current >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], string.format('%.0f', current + 1))
redis.call('SET', KEYS[3], ARGV[2], 'EX', 600)
return 1
`;

export interface ScriptedRedis extends Redis {
  /** Queues events that haven't been seen, and returns how many were new. */
  enqueueEvents(stream: string, ttlSeconds: number, ...fields: string[]): Promise<number>;
  /** Claims one ad under the cap. Returns 1 if it was claimed. */
  reserveAd(
    servedKey: string,
    deliveredKey: string,
    lastServedKey: string,
    cap: number,
    now: number,
  ): Promise<number>;
}

const connect = (): ScriptedRedis => {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  client.on('error', (error: Error) => console.error('Redis:', error.message));
  client.defineCommand('enqueueEvents', { numberOfKeys: 1, lua: ENQUEUE_EVENTS });
  client.defineCommand('reserveAd', { numberOfKeys: 3, lua: RESERVE_AD });
  return client as ScriptedRedis;
};

export const redis = connect();

/** A separate connection, because waiting for new events blocks the one it uses. */
export const createBlockingRedis = (): Redis => {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  client.on('error', (error: Error) => console.error('Redis:', error.message));
  return client;
};

export const counterKeys = (
  campaignId: string,
): { delivered: string; served: string; lastServed: string } => ({
  delivered: `delivered:${campaignId}`,
  served: `served:${campaignId}`,
  lastServed: `last-served:${campaignId}`,
});
