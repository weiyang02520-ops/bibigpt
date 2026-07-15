import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { FREE_LIMIT_COUNT, LOGIN_LIMIT_COUNT } from '~/utils/constants'

const cacheRedisConfigured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
const rateRedisConfigured = Boolean(
  process.env.UPSTASH_RATE_REDIS_REST_URL && process.env.UPSTASH_RATE_REDIS_REST_TOKEN,
)

export const cacheRedis = cacheRedisConfigured ? Redis.fromEnv() : null

const rateRedis = rateRedisConfigured
  ? new Redis({
      url: process.env.UPSTASH_RATE_REDIS_REST_URL,
      token: process.env.UPSTASH_RATE_REDIS_REST_TOKEN,
    })
  : null

export const ratelimitForIps = rateRedis
  ? new Ratelimit({
      redis: rateRedis,
      limiter: Ratelimit.fixedWindow(FREE_LIMIT_COUNT, '1 d'),
      analytics: true,
    })
  : null

export const ratelimitForApiKeyIps = rateRedis
  ? new Ratelimit({
      redis: rateRedis,
      limiter: Ratelimit.fixedWindow(FREE_LIMIT_COUNT * 2, '1 d'),
      analytics: true,
    })
  : null

export const ratelimitForFreeAccounts = rateRedis
  ? new Ratelimit({
      redis: rateRedis,
      limiter: Ratelimit.fixedWindow(LOGIN_LIMIT_COUNT, '1 d'),
      analytics: true,
    })
  : null
