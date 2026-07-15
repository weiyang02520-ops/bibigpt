import { TranscriptSegment } from '~/lib/course/types'

export type TranscriptChunk = {
  start: number
  end: number
  text: string
  segments: TranscriptSegment[]
}

const formatTimestamp = (seconds: number) => {
  const wholeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const remainingSeconds = wholeSeconds % 60
  const mmss = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mmss}` : mmss
}

const toTranscriptText = (segments: TranscriptSegment[]) =>
  segments.map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`).join('\n')

export function chunkTranscript(
  transcript: TranscriptSegment[],
  options: { maxDuration?: number; maxCharacters?: number } = {},
): TranscriptChunk[] {
  const maxDuration = options.maxDuration || 8 * 60
  const maxCharacters = options.maxCharacters || 24000
  const sorted = [...transcript]
    .filter((segment) => segment.text.trim())
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const chunks: TranscriptChunk[] = []
  let current: TranscriptSegment[] = []
  let characterCount = 0

  const flush = () => {
    if (current.length < 1) {
      return
    }
    chunks.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: toTranscriptText(current),
      segments: current,
    })
    current = []
    characterCount = 0
  }

  for (const segment of sorted) {
    const firstStart = current[0]?.start ?? segment.start
    const nextCharacterCount = characterCount + segment.text.length + 16
    if (current.length > 0 && (segment.end - firstStart > maxDuration || nextCharacterCount > maxCharacters)) {
      flush()
    }
    current.push(segment)
    characterCount += segment.text.length + 16
  }
  flush()
  return chunks
}

export { formatTimestamp }
