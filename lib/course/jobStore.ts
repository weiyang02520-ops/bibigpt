import { del, get, set } from 'idb-keyval'
import { CourseJob } from '~/lib/course/types'

const JOB_PREFIX = 'bibigpt-course-job:'
const ACTIVE_JOB_KEY = 'bibigpt-course-active-job'

export const getCourseJobId = (service: string, videoId: string, pageNumber: number) =>
  `${service}:${videoId}:${pageNumber}`

const getStorageKey = (jobId: string) => `${JOB_PREFIX}${jobId}`

export const loadCourseJob = async (jobId: string) => {
  const value = await get<CourseJob>(getStorageKey(jobId))
  return value?.version === 1 || value?.version === 2 ? value : null
}

export const saveCourseJob = async (job: CourseJob) => {
  await Promise.all([set(getStorageKey(job.id), job), set(ACTIVE_JOB_KEY, job.id)])
}

export const loadActiveCourseJob = async () => {
  const jobId = await get<string>(ACTIVE_JOB_KEY)
  return typeof jobId === 'string' && jobId ? loadCourseJob(jobId) : null
}

export const deleteCourseJob = async (jobId: string) => {
  await del(getStorageKey(jobId))
  if ((await get<string>(ACTIVE_JOB_KEY)) === jobId) {
    await del(ACTIVE_JOB_KEY)
  }
}
