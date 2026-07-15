import type { NextApiResponse } from 'next'

export function prepareTextStreamResponse(res: NextApiResponse) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Content-Encoding', 'identity')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
}

export async function writeWebStreamToNodeResponse(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  res: NextApiResponse,
) {
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value) {
        res.write(Buffer.from(value))
        const flush = (res as NextApiResponse & { flush?: () => void }).flush
        flush?.call(res)
      }
    }
  } finally {
    reader.releaseLock()
  }

  res.end()
}
