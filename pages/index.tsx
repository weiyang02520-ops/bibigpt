import { AnalyticsBrowser } from '@segment/analytics-next'
import { Analytics as AnalyticsType } from '@segment/analytics-next/dist/types/core/analytics'
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { useAnalytics } from '~/components/context/analytics'
import SlugPage from './[...slug]'

const Home: NextPage = () => {
  const [analytics, setAnalytics] = useState<AnalyticsType | undefined>(undefined)

  const { analytics: analyticsBrowser, enabled: analyticsEnabled } = useAnalytics()
  useEffect(() => {
    if (!analyticsEnabled) {
      setAnalytics(undefined)
      return
    }

    async function handleAnalyticsLoading(browser: AnalyticsBrowser) {
      try {
        const [response, ctx] = await browser
        setAnalytics(response)
        ;(window as any).analytics = response
        ;(window as any).analytics?.page()
      } catch (err) {
        console.error(err)
        setAnalytics(undefined)
      }
    }
    handleAnalyticsLoading(analyticsBrowser).catch(console.error)
  }, [analyticsBrowser, analyticsEnabled])
  return <SlugPage />
}
export default Home
