import { fetchYoutubeSubtitleUrls } from '~/lib/youtube/fetchYoutubeSubtitleUrls'
import { reduceYoutubeSubtitleTimestamp } from '~/utils/reduceSubtitleTimestamp'

export async function fetchYoutubeSubtitle(videoId: string, shouldShowTimestamp: boolean | undefined) {
  const { title, subtitleList } = await fetchYoutubeSubtitleUrls(videoId)
  if (subtitleList.length < 1) {
    return { title, subtitlesArray: null }
  }

  if (shouldShowTimestamp) {
    const timestampSubtitles = subtitleList.map(({ text, offset }) => ({
      start: offset / 1000,
      lines: [text],
    }))
    const transcripts = reduceYoutubeSubtitleTimestamp(timestampSubtitles).filter(({ text }) => text.trim())
    return { title, subtitlesArray: transcripts.length > 0 ? transcripts : null }
  }

  const transcripts = subtitleList.map(({ text }, index) => ({ text, index }))
  return { title, subtitlesArray: transcripts.length > 0 ? transcripts : null }
}
