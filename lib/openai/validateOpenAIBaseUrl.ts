import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { ApiRequestError } from '~/lib/apiRequestError'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

function parseIpv4(address: string) {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null
  }
  return octets
}

function isNonPublicIpv4(address: string) {
  const octets = parseIpv4(address)
  if (!octets) {
    return true
  }

  const [a, b, c] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function expandIpv6(address: string) {
  const withoutZone = address.toLowerCase().split('%')[0]
  let normalized = withoutZone

  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':')
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1))
    if (!ipv4) {
      return null
    }
    const firstGroup = ((ipv4[0] << 8) | ipv4[1]).toString(16)
    const secondGroup = ((ipv4[2] << 8) | ipv4[3]).toString(16)
    normalized = `${normalized.slice(0, lastColon)}:${firstGroup}:${secondGroup}`
  }

  const halves = normalized.split('::')
  if (halves.length > 2) {
    return null
  }

  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null
  }

  const groups = [...head, ...Array(missing).fill('0'), ...tail]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null
  }

  return groups.map((group) => Number.parseInt(group, 16))
}

function isNonPublicIpv6(address: string) {
  const groups = expandIpv6(address)
  if (!groups) {
    return true
  }

  const isUnspecified = groups.every((group) => group === 0)
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1
  const firstByte = groups[0] >> 8
  const secondByte = groups[0] & 0xff
  const isUniqueLocal = (firstByte & 0xfe) === 0xfc
  const isLinkLocal = firstByte === 0xfe && (secondByte & 0xc0) === 0x80
  const isMulticast = firstByte === 0xff
  const isDocumentation = groups[0] === 0x2001 && groups[1] === 0x0db8
  const isIpv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff

  if (isIpv4Mapped) {
    const mappedAddress = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.')
    return isNonPublicIpv4(mappedAddress)
  }

  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isMulticast || isDocumentation
}

function isNonPublicIp(address: string) {
  const version = isIP(address)
  if (version === 4) {
    return isNonPublicIpv4(address)
  }
  if (version === 6) {
    return isNonPublicIpv6(address)
  }
  return true
}

function allowUnsafeDevelopmentUrl() {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_OPENAI_BASE_URL === 'true'
}

export async function validateOpenAIBaseUrl(baseUrl?: string) {
  const rawValue = baseUrl?.trim() || process.env.OPENAI_COMPATIBLE_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL

  let parsed: URL
  try {
    parsed = new URL(rawValue)
  } catch {
    throw new ApiRequestError(400, 'Base URL 格式无效，请填写完整的 HTTPS 地址。')
  }

  const allowPrivate = allowUnsafeDevelopmentUrl()
  if (parsed.protocol !== 'https:' && !(allowPrivate && parsed.protocol === 'http:')) {
    throw new ApiRequestError(400, 'Base URL 必须使用 HTTPS。')
  }
  if (parsed.username || parsed.password) {
    throw new ApiRequestError(400, 'Base URL 不能包含用户名或密码。')
  }
  if (parsed.search || parsed.hash) {
    throw new ApiRequestError(400, 'Base URL 不能包含查询参数或锚点。')
  }

  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  if (!hostname) {
    throw new ApiRequestError(400, 'Base URL 缺少有效域名。')
  }

  if (!allowPrivate) {
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      throw new ApiRequestError(400, 'Base URL 不能指向本机或局域网地址。')
    }

    if (isIP(hostname)) {
      if (isNonPublicIp(hostname)) {
        throw new ApiRequestError(400, 'Base URL 不能指向本机或局域网地址。')
      }
    } else {
      let addresses: Array<{ address: string }>
      try {
        addresses = await lookup(hostname, { all: true, verbatim: true })
      } catch {
        throw new ApiRequestError(400, '无法解析 Base URL 的域名，请检查地址是否正确。')
      }

      if (!addresses.length || addresses.some(({ address }) => isNonPublicIp(address))) {
        throw new ApiRequestError(400, 'Base URL 不能解析到本机或局域网地址。')
      }
    }
  }

  return parsed.toString().replace(/\/+$/, '')
}
