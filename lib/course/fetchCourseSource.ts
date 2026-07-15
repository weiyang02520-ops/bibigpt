import { fetchBilibiliCourseSource } from '~/lib/bilibili/fetchBilibiliCourseSource'
import { CourseSourceRequest } from '~/lib/course/schemas'
import { CourseSource, TranscriptSegment } from '~/lib/course/types'
import { VideoService } from '~/lib/types'
import { fetchYoutubeSubtitleUrls } from '~/lib/youtube/fetchYoutubeSubtitleUrls'
import { resolveYoutubeAudioStream } from '~/lib/youtube/resolveYoutubeAudioStream'

const fetchYoutubeLocalAsrSource = async (videoId: string, fallbackTitle?: string): Promise<CourseSource> => {
  const audio = await resolveYoutubeAudioStream(videoId)
  const query = new URLSearchParams({
    videoId,
    itag: String(audio.itag),
    revision: audio.revision,
  })
  return {
    service: VideoService.Youtube,
    videoId,
    pageNumber: 1,
    title: audio.title || fallbackTitle || videoId,
    duration: audio.duration,
    mode: 'local-asr',
    transcript: [],
    audio: {
      url: `/api/course/youtube-audio?${query.toString()}`,
      mimeType: audio.mimeType,
      codec: audio.codec,
      bandwidth: audio.bitrate,
      duration: audio.duration,
      size: audio.size,
    },
    frames: null,
  }
}

const fetchYoutubeCourseSource = async (videoId: string): Promise<CourseSource> => {
  let title = videoId
  let subtitleList: Awaited<ReturnType<typeof fetchYoutubeSubtitleUrls>>['subtitleList'] = []
  try {
    const subtitleSource = await fetchYoutubeSubtitleUrls(videoId)
    title = subtitleSource.title
    subtitleList = subtitleSource.subtitleList
  } catch (error) {
    try {
      return await fetchYoutubeLocalAsrSource(videoId, title)
    } catch (audioError) {
      const captionMessage = error instanceof Error ? error.message : '字幕获取失败'
      const audioMessage = audioError instanceof Error ? audioError.message : '音频解析失败'
      throw new Error(`YouTube 字幕不可用，音频转写兜底也失败：${captionMessage}；${audioMessage}`)
    }
  }

  if (subtitleList.length < 1) {
    return fetchYoutubeLocalAsrSource(videoId, title)
  }

  const transcript: TranscriptSegment[] = subtitleList.map((item, index) => ({
    id: `caption-${index}`,
    start: item.offset / 1000,
    end: (item.offset + item.duration) / 1000,
    text: item.text,
    source: 'caption',
  }))
  const duration = transcript.reduce((maximum, item) => Math.max(maximum, item.end), 0)

  return {
    service: VideoService.Youtube,
    videoId,
    pageNumber: 1,
    title,
    duration,
    mode: 'captions',
    transcript,
    audio: null,
    frames: null,
  }
}

export const fetchCourseSource = async (request: CourseSourceRequest) => {
  if (request.service === VideoService.Bilibili) {
    return fetchBilibiliCourseSource(request.videoId, request.pageNumber)
  }
  return fetchYoutubeCourseSource(request.videoId)
}
