// This file sets a custom webpack configuration to use your Next.js app
// with Sentry.
// https://nextjs.org/docs/api-reference/next.config.js/introduction
// https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
const { withSentryConfig } = require('@sentry/nextjs')

function toHostname(value) {
  if (!value) {
    return null
  }

  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname
  } catch {
    return null
  }
}

const supabaseHostname = toHostname(process.env.SUPABASE_HOSTNAME || process.env.NEXT_PUBLIC_SUPABASE_URL)
const internalApiHostname = process.env.INTERNAL_API_HOSTNAME?.replace(/\/+$/, '')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      ...(supabaseHostname ? [{ protocol: 'https', hostname: supabaseHostname }] : []),
      {
        protocol: 'https',
        hostname: 'b.jimmylv.cn',
      },
      {
        protocol: 'https',
        hostname: 'bibigpt.co',
      },
      {
        protocol: 'https',
        hostname: 'avatars.dicebear.com',
      },
    ],
  },
  async rewrites() {
    return [
      ...(internalApiHostname
        ? [
            {
              source: '/api/:path*',
              destination: `${internalApiHostname}/api/:path*`,
            },
          ]
        : []),
      {
        source: '/blocked',
        destination: '/shop',
      },
    ]
  },
}

const shouldEnableSentry = Boolean(process.env.SENTRY_AUTH_TOKEN)

module.exports = shouldEnableSentry
  ? withSentryConfig(nextConfig, { silent: true }, { hideSourceMaps: true })
  : nextConfig
