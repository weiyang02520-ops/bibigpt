import { VideoConfig } from '~/lib/types'

function normalizeCacheToken(value: unknown, fallback = 'default') {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/[^\w.-]/g, '_')
  return (normalized || fallback).slice(0, 120)
}

function normalizeProviderToken(baseUrl?: string) {
  if (!baseUrl?.trim()) {
    return 'default-provider'
  }

  try {
    const parsed = new URL(baseUrl)
    return normalizeCacheToken(`${parsed.protocol}//${parsed.host}${parsed.pathname}`)
  } catch {
    return 'invalid-provider'
  }
}

export function getCacheId(videoConfig: VideoConfig, baseUrl?: string) {
  const {
    showTimestamp,
    showEmoji,
    videoId,
    pageNumber,
    outputLanguage,
    detailLevel,
    sentenceNumber,
    outlineLevel,
    model,
  } = videoConfig

  return [
    'transcript-v3',
    normalizeCacheToken(videoId),
    normalizeCacheToken(pageNumber, '1'),
    showTimestamp ? 'timestamp' : 'plain',
    showEmoji ? 'emoji' : 'noemoji',
    normalizeCacheToken(outputLanguage),
    normalizeCacheToken(detailLevel),
    normalizeCacheToken(sentenceNumber),
    normalizeCacheToken(outlineLevel),
    normalizeCacheToken(model),
    normalizeProviderToken(baseUrl),
  ].join('-')
}
