import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveBilibiliFrameSheet } from '~/lib/bilibili/fetchBilibiliCourseSource'

const MAX_FRAME_BYTES = 4 * 1024 * 1024
const VIDEO_ID_PATTERN = /^(?:BV[0-9A-Za-z]{10}|av\d+)$/

const getIntegerQuery = (value: string | string[] | undefined, allowZero = false) => {
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  const minimum = allowZero ? 0 : 1
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null
}

export const config = {
  api: {
    responseLimit: false,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'HEAD' && req.method !== 'GET') {
    res.setHeader('Allow', 'HEAD, GET')
    return res.status(405).end()
  }

  const videoId = Array.isArray(req.query.videoId) ? req.query.videoId[0] : req.query.videoId
  const cid = getIntegerQuery(req.query.cid)
  const sheet = getIntegerQuery(req.query.sheet, true)
  if (!videoId || !VIDEO_ID_PATTERN.test(videoId) || !cid || sheet === null || sheet > 99) {
    return res.status(400).end()
  }

  try {
    const imageUrl = await resolveBilibiliFrameSheet(videoId, cid, sheet)
    const upstream = await fetch(imageUrl, {
      method: req.method,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/jpeg,image/png,*/*;q=0.8',
        Referer: `https://www.bilibili.com/video/${videoId}`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    })
    const contentType = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || ''
    const contentLength = Number(upstream.headers.get('content-length'))
    if (
      !upstream.ok ||
      !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(contentType) ||
      (Number.isFinite(contentLength) && contentLength > MAX_FRAME_BYTES)
    ) {
      return res.status(502).end()
    }

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.method === 'HEAD') {
      if (Number.isSafeInteger(contentLength) && contentLength >= 0) {
        res.setHeader('Content-Length', String(contentLength))
      }
      return res.status(200).end()
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (bytes.length < 1 || bytes.length > MAX_FRAME_BYTES) {
      return res.status(502).end()
    }
    res.setHeader('Content-Length', String(bytes.length))
    return res.status(200).send(Buffer.from(bytes))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    return res.status(502).end()
  }
}
