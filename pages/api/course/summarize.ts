import type { NextApiRequest, NextApiResponse } from 'next'
import { getApiRequestStatus } from '~/lib/apiRequestError'
import { courseSummarizeRequestSchema } from '~/lib/course/schemas'
import { composeCourseNotes, summarizeCourseChunk } from '~/lib/course/summarizeCourseText'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const parsed = courseSummarizeRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: '课程总结参数无效' })
  }

  try {
    const result =
      parsed.data.action === 'chunk' ? await summarizeCourseChunk(parsed.data) : await composeCourseNotes(parsed.data)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json(result)
  } catch (error: any) {
    const status = getApiRequestStatus(error)
    console.error(error?.message || error)
    return res.status(status).json({ error: error?.message || '课程总结失败' })
  }
}
