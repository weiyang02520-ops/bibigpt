import type { NextApiRequest, NextApiResponse } from 'next'
import { createYoutubeUserAgent, resolveYoutubeAudioStream } from '~/lib/youtube/resolveYoutubeAudioStream'

const MAX_RANGE_SIZE = 2 * 1024 * 1024
const VIDEO_ID_PATTERN = /^[0-9A-Za-z_-]{11}$/

const getIntegerQuery = (value: string | string[] | undefined) => {
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const getStringQuery = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value || '').trim()

const parseRange = (header: string | undefined, size: number) => {
  const match = header?.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) {
    return null
  }
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : Math.min(size - 1, start + MAX_RANGE_SIZE - 1)
  const end = Math.min(size - 1, requestedEnd)
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end - start + 1 > MAX_RANGE_SIZE
  ) {
    return null
  }
  return { start, end }
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

  const videoId = getStringQuery(req.query.videoId)
  const revision = getStringQuery(req.query.revision)
  const itag = getIntegerQuery(req.query.itag)
  if (!VIDEO_ID_PATTERN.test(videoId) || !itag || !revision) {
    return res.status(400).end()
  }

  try {
    const audio = await resolveYoutubeAudioStream(videoId, itag)
    if (audio.revision !== revision) {
      return res.status(409).end()
    }

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', audio.mimeType)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Encoding', 'identity')
    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', String(audio.size))
      return res.status(200).end()
    }

    const range = parseRange(req.headers.range, audio.size)
    if (!range) {
      res.setHeader('Content-Range', `bytes */${audio.size}`)
      return res.status(416).end()
    }

    const upstream = await fetch(audio.url, {
      headers: {
        Range: `bytes=${range.start}-${range.end}`,
        'User-Agent': createYoutubeUserAgent(),
      },
      signal: AbortSignal.timeout(20000),
    })
    if (upstream.status !== 206 || !upstream.body) {
      return res.status(502).end()
    }

    const expectedLength = range.end - range.start + 1
    const upstreamLength = Number(upstream.headers.get('content-length'))
    const upstreamRange = upstream.headers.get('content-range')
    if (
      upstreamRange !== `bytes ${range.start}-${range.end}/${audio.size}` ||
      !Number.isSafeInteger(upstreamLength) ||
      upstreamLength !== expectedLength
    ) {
      return res.status(502).end()
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (bytes.length !== expectedLength) {
      return res.status(502).end()
    }

    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${audio.size}`)
    res.setHeader('Content-Length', String(expectedLength))
    return res.end(Buffer.from(bytes))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    if (!res.headersSent) {
      return res.status(502).end()
    }
    res.destroy()
  }
}
