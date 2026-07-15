import type { NextApiRequest, NextApiResponse } from 'next'
import { courseSourceRequestSchema } from '~/lib/course/schemas'
import { fetchCourseSource } from '~/lib/course/fetchCourseSource'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const parsed = courseSourceRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: '视频来源参数无效' })
  }

  try {
    const source = await fetchCourseSource(parsed.data)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json(source)
  } catch (error: any) {
    console.error(error?.message || error)
    return res.status(502).json({ error: error?.message || '视频来源检查失败' })
  }
}
