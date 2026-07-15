# BibiGPT Personal BYOK

一个部署在 Vercel 上的个人字幕视频总结工具。当前支持带可访问字幕的哔哩哔哩和 YouTube 视频，并允许在网页中填写自己的 OpenAI-compatible API 配置。

- 在线地址：<https://bibigpt-six.vercel.app>
- GitHub：<https://github.com/weiyang02520-ops/bibigpt>
- 上游项目：<https://github.com/JimmyLv/BibiGPT>

## 当前能力

- 使用网页中填写的 API Key、Base URL 和任意兼容模型 ID。
- OpenRouter OAuth 仅作为可选配置方式。
- 获取平台已有字幕，不下载视频文件。
- 没有字幕时停止请求，不使用视频简介冒充字幕。
- 将模型结果以纯文本流逐块显示。
- API Key 保存在当前浏览器的 localStorage，不写入项目或结果缓存。
- 个人 BYOK 请求没有购买、License 或每日次数限制。
- Supabase、Upstash、Segment、Sentry 和服务端模型 Key 均为可选配置。

## 使用

1. 打开在线地址。
2. 填写 API Key 和 API Base URL。
3. 填写模型服务支持的模型 ID。
4. 粘贴哔哩哔哩或 YouTube 视频链接并点击“一键总结”。

生产环境中的自定义 Base URL 必须是公网 HTTPS 地址。`localhost`、局域网、链路本地和其他非公网地址会被拒绝。

## 本地运行

```powershell
npm ci --ignore-scripts
Copy-Item .example.env .env.local
npm run dev
```

应用默认运行在 <http://localhost:3000>。

如需运行不消耗真实 Token 的本地端到端验收：

```powershell
# 终端 1
npm run mock:openai

# 终端 2
$env:ALLOW_PRIVATE_OPENAI_BASE_URL='true'
npm run dev
```

测试页配置：

- API Key：任意非空测试值，例如 `mock-key`
- Base URL：`http://127.0.0.1:4010/v1`
- 模型 ID：`mock-bibigpt`
- 视频：`https://www.youtube.com/watch?v=dQw4w9WgXcQ`

Mock 只会在请求中发现该测试视频的真实字幕片段后返回成功结果。

## 部署

Vercel 部署步骤见 [deploy-ch.md](./deploy-ch.md)。个人 BYOK 模式不要求配置服务端 API Key、Supabase 或 Upstash。

## 可选环境变量

以 [.example.env](./.example.env) 为准，常用项包括：

- `BILIBILI_SESSION_TOKEN`：部分 B 站字幕需要登录态才能访问。
- `OPENAI_COMPATIBLE_API_KEY`：可选服务端 Key；个人部署通常留空。
- `OPENAI_COMPATIBLE_BASE_URL` / `OPENAI_COMPATIBLE_MODEL`：服务端默认模型配置。
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`：可选结果缓存。
- `NEXT_PUBLIC_SITE_URL`：站点公开地址，用于页面元数据。

不要提交 `.env*`、API Key、B 站 Session Token 或其他密钥。

## 已知边界

- 只总结平台已有字幕，不包含 ASR、本地文件上传或视频截图。
- B 站字幕可能要求 `BILIBILI_SESSION_TOKEN`。
- YouTube 字幕依赖非官方接口，平台策略变化时可能失效。
- BibiGPT v1 会压缩较长字幕，不适合直接处理完整的二十小时课程。
- Obsidian 导出、课程分段总结和重点截图属于后续独立流程，不在当前网页版本中。

## 验证

```powershell
npx prettier --check .
npx tsc --noEmit
npm run build
```

本分支基于 BibiGPT v1 修改，继续遵循仓库中的 GPL-3.0 许可证。
