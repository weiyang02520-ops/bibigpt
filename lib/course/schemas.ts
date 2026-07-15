import { z } from 'zod'
import { VideoService } from '~/lib/types'

export const courseSourceRequestSchema = z.object({
  service: z.enum([VideoService.Bilibili, VideoService.Youtube]),
  videoId: z.string().trim().min(1).max(64),
  pageNumber: z.coerce.number().int().min(1).max(1000).default(1),
})

export type CourseSourceRequest = z.infer<typeof courseSourceRequestSchema>

const courseUserConfigSchema = z.object({
  userKey: z.string().trim().min(1).max(4096),
  baseUrl: z.string().trim().max(2048).optional(),
})

const termSchema = z.object({
  term: z.string().trim().min(1).max(160),
  explanation: z.string().trim().min(1).max(1200),
})

const keyMomentSchema = z.object({
  timestamp: z.number().finite().min(0),
  reason: z.string().trim().min(1).max(800),
})

export const courseChunkSummarySchema = z.object({
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(4000),
  keyPoints: z.array(z.string().trim().min(1).max(1200)).min(1).max(12),
  terms: z.array(termSchema).max(16),
  keyMoments: z.array(keyMomentSchema).max(8),
})

export const courseNotesSchema = z.object({
  title: z.string().trim().min(1).max(300),
  overview: z.string().trim().min(1).max(6000),
  chapters: z
    .array(
      z.object({
        timestamp: z.number().finite().min(0),
        title: z.string().trim().min(1).max(240),
        summary: z.string().trim().min(1).max(3000),
        details: z.array(z.string().trim().min(1).max(1200)).min(1).max(12),
      }),
    )
    .min(1)
    .max(80),
  takeaways: z.array(z.string().trim().min(1).max(1200)).min(1).max(30),
  terms: z.array(termSchema).max(60),
  keyMoments: z.array(keyMomentSchema).min(1).max(16),
})

export const courseChunkRequestSchema = z.object({
  action: z.literal('chunk'),
  model: z.string().trim().min(1).max(300),
  outputLanguage: z.string().trim().min(1).max(80).default('Chinese'),
  title: z.string().trim().min(1).max(600),
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  transcript: z.string().trim().min(1).max(40000),
  userConfig: courseUserConfigSchema,
})

export const courseComposeRequestSchema = z.object({
  action: z.literal('compose'),
  model: z.string().trim().min(1).max(300),
  outputLanguage: z.string().trim().min(1).max(80).default('Chinese'),
  title: z.string().trim().min(1).max(600),
  sourceUrl: z.string().url().max(3000),
  duration: z.number().finite().positive(),
  chunkSummaries: z.array(
    courseChunkSummarySchema.extend({
      start: z.number().finite().min(0),
      end: z.number().finite().min(0),
    }),
  ),
  userConfig: courseUserConfigSchema,
})

export const courseSummarizeRequestSchema = z.discriminatedUnion('action', [
  courseChunkRequestSchema,
  courseComposeRequestSchema,
])
