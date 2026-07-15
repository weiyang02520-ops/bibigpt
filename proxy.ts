import { Redis } from '@upstash/redis'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { SummarizeParams } from '~/lib/types'
import { getCacheId } from '~/utils/getCacheId'

const hasCacheRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
const redis = hasCacheRedis ? Redis.fromEnv() : null
const defaultProviderBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL || 'https://api.openai.com/v1'

function isChatRequest(req: NextRequest) {
  return req.nextUrl.pathname === '/api/chat'
}

export async function proxy(req: NextRequest) {
  if (req.method !== 'POST') {
    return NextResponse.next()
  }

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.next()
  }

  try {
    let body: Partial<SummarizeParams>
    try {
      body = (await req.json()) as Partial<SummarizeParams>
    } catch (parseError) {
      console.warn('proxy skipped non-json/empty body request', parseError)
      return NextResponse.next()
    }

    const { videoConfig, userConfig } = body

    if (!videoConfig) {
      return NextResponse.next()
    }

    const cacheId = getCacheId(videoConfig, userConfig?.baseUrl || defaultProviderBaseUrl)
    const result = redis ? await redis.get<string>(cacheId) : null
    if (result) {
      console.log('hit cache for ', cacheId)
      if (isChatRequest(req)) {
        return new NextResponse(result, {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }
      return NextResponse.json(result)
    }
  } catch (e) {
    console.error(e)
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/sumup', '/api/chat'],
}
