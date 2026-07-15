import { VideoService } from '~/lib/types'

export type TranscriptSegmentSource = 'caption' | 'asr'

export type TranscriptSegment = {
  id: string
  start: number
  end: number
  text: string
  source: TranscriptSegmentSource
}

export type CourseAudioSource = {
  url: string
  mimeType: string
  codec: string
  bandwidth: number
  duration: number
  size: number | null
}

export type CourseFrameManifest = {
  type: 'bilibili-sprite'
  images: string[]
  timestamps: number[]
  columns: number
  rows: number
  frameWidth: number
  frameHeight: number
}

export type CourseSource = {
  service: VideoService.Bilibili | VideoService.Youtube
  videoId: string
  pageNumber: number
  title: string
  duration: number
  mode: 'captions' | 'local-asr'
  transcript: TranscriptSegment[]
  audio: CourseAudioSource | null
  frames: CourseFrameManifest | null
}

export type CourseChunkSummary = {
  start: number
  end: number
  title: string
  summary: string
  keyPoints: string[]
  terms: Array<{ term: string; explanation: string }>
  keyMoments: Array<{ timestamp: number; reason: string }>
}

export type CourseChapter = {
  timestamp: number
  title: string
  summary: string
  details: string[]
}

export type CourseNotes = {
  title: string
  overview: string
  chapters: CourseChapter[]
  takeaways: string[]
  terms: Array<{ term: string; explanation: string }>
  keyMoments: Array<{ timestamp: number; reason: string }>
}

export type CourseJobStatus =
  | 'inspecting'
  | 'loading-asr'
  | 'transcribing'
  | 'summarizing'
  | 'composing'
  | 'complete'
  | 'cancelled'
  | 'failed'

export type CourseJob = {
  version: 1 | 2
  id: string
  sourceFingerprint: string
  sourceUrl?: string
  asrModel?: string | null
  status: CourseJobStatus
  source: Omit<CourseSource, 'audio'>
  transcript: TranscriptSegment[]
  transcribedUntil: number
  chunkSummaries: CourseChunkSummary[]
  notes: CourseNotes | null
  error: string | null
  updatedAt: string
}

export type CourseProgress = {
  status: CourseJobStatus
  label: string
  completed: number
  total: number
}
