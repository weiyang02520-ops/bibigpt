import Document, { Head, Html, Main, NextScript } from 'next/document'

class MyDocument extends Document {
  render() {
    const baseDomain = process.env.NEXT_PUBLIC_SITE_URL || 'https://bibigpt-six.vercel.app'
    const description = '使用自己的 OpenAI-compatible API，总结带字幕的哔哩哔哩与 YouTube 视频。'
    const ogimage = `${baseDomain}/og-image.png`
    const sitename = 'BibiGPT 个人 BYOK'
    const title = 'BibiGPT · 字幕视频总结'

    return (
      <Html lang="zh-CN">
        <Head>
          <link
            rel="icon"
            href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐣</text></svg>"
          />
          <meta name="description" content={description} />
          <meta property="og:site_name" content={sitename} />
          <meta property="og:description" content={description} />
          <meta property="og:title" content={title} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={title} />
          <meta name="twitter:description" content={description} />
          <meta property="og:image" content={ogimage} />
          <meta name="twitter:image" content={ogimage} />
        </Head>
        <body className="bg-white text-gray-700">
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}

export default MyDocument
