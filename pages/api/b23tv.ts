import type { NextApiRequest, NextApiResponse } from 'next'

const ALLOWED_SHORT_HOSTS = new Set(['b23.tv', 'www.b23.tv'])

function isAllowedRedirectHost(hostname: string) {
  const normalized = hostname.toLowerCase()
  return ALLOWED_SHORT_HOSTS.has(normalized) || normalized === 'bilibili.com' || normalized.endsWith('.bilibili.com')
}

function getSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ errorMessage: 'Method Not Allowed' })
  }

  const rawUrl = getSingleQueryValue(req.query.url)?.trim()
  if (!rawUrl) {
    return res.status(400).json({ errorMessage: '缺少 b23.tv 短链接。' })
  }

  let shortUrl: URL
  try {
    shortUrl = new URL(rawUrl)
  } catch {
    return res.status(400).json({ errorMessage: 'b23.tv 短链接格式无效。' })
  }

  if (shortUrl.protocol !== 'https:' || !ALLOWED_SHORT_HOSTS.has(shortUrl.hostname.toLowerCase())) {
    return res.status(400).json({ errorMessage: '只允许解析 HTTPS b23.tv 短链接。' })
  }

  try {
    const signal = AbortSignal.timeout(8000)
    let finalUrl = shortUrl
    let resolved = false

    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const response = await fetch(finalUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        redirect: 'manual',
        signal,
      })

      if (response.status < 300 || response.status >= 400) {
        resolved = true
        break
      }

      const location = response.headers.get('location')
      if (!location) {
        return res.status(400).json({ errorMessage: 'b23.tv 返回了无效重定向。' })
      }

      const nextUrl = new URL(location, finalUrl)
      if (nextUrl.protocol !== 'https:' || !isAllowedRedirectHost(nextUrl.hostname)) {
        return res.status(400).json({ errorMessage: 'b23.tv 重定向到了不受信任的地址。' })
      }
      finalUrl = nextUrl
    }

    if (!resolved) {
      return res.status(400).json({ errorMessage: 'b23.tv 短链接重定向次数过多。' })
    }

    const finalHostname = finalUrl.hostname.toLowerCase()
    const isBilibiliVideo =
      (finalHostname === 'bilibili.com' || finalHostname.endsWith('.bilibili.com')) &&
      finalUrl.pathname.startsWith('/video/')

    if (!isBilibiliVideo) {
      return res.status(400).json({ errorMessage: '该短链接没有指向 Bilibili 视频。' })
    }

    return res.status(200).json({ url: finalUrl.toString() })
  } catch {
    return res.status(502).json({ errorMessage: 'b23.tv 短链接解析失败，请稍后重试。' })
  }
}
