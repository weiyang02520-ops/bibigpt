import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { FREE_LIMIT_COUNT, LOGIN_LIMIT_COUNT } from '~/utils/constants'

const redisUrl = process.env.UPSTASH_RATE_REDIS_REST_URL
const redisToken = process.env.UPSTASH_RATE_REDIS_REST_TOKEN
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null

export const ratelimitForIps = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(FREE_LIMIT_COUNT, '1 d'),
      analytics: true,
    })
  : null

export const ratelimitForApiKeyIps = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(FREE_LIMIT_COUNT * 2, '1 d'),
      analytics: true,
    })
  : null

export const ratelimitForFreeAccounts = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(LOGIN_LIMIT_COUNT, '1 d'),
      analytics: true,
    })
  : null
