// @ts-nocheck
// copy from https://github.com/segmentio/analytics-next/blob/master/examples/with-next-js
import React from 'react'
import { AnalyticsBrowser } from '@segment/analytics-next'
import { useCDNUrl, useWriteKey } from '~/hooks/useConfig'
import { isDev } from '~/utils/env'

const disabledAnalytics = {
  identify: async () => undefined,
  page: async () => undefined,
  track: async () => undefined,
} as unknown as AnalyticsBrowser

const AnalyticsContext = React.createContext<{
  analytics: AnalyticsBrowser
  enabled: boolean
  writeKey: string
  setWriteKey: (key: string) => void
  cdnURL: string
  setCDNUrl: (url: string) => void
}>(undefined)

export const AnalyticsProvider: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const [writeKey, setWriteKey] = useWriteKey()
  const [cdnURL, setCDNUrl] = useCDNUrl()
  const enabled = typeof writeKey === 'string' && writeKey.trim().length > 0 && writeKey !== 'undefined'

  const analytics = React.useMemo(() => {
    if (!enabled) {
      return disabledAnalytics
    }
    isDev && console.log(`AnalyticsBrowser loading...`, JSON.stringify({ writeKey, cdnURL }))
    return AnalyticsBrowser.load({ writeKey, cdnURL })
  }, [writeKey, cdnURL, enabled])
  return (
    <AnalyticsContext.Provider value={{ analytics, enabled, writeKey, setWriteKey, cdnURL, setCDNUrl }}>
      {children}
    </AnalyticsContext.Provider>
  )
}

// Create an analytics hook that we can use with other components.
export const useAnalytics = () => {
  const result = React.useContext(AnalyticsContext)
  if (!result) {
    throw new Error('Context used outside of its Provider!')
  }
  return result
}
