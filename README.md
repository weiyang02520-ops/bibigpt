# BibiGPT Personal BYOK

一个部署在 Vercel 上的个人课程视频总结工具。当前支持哔哩哔哩和 YouTube，并允许在网页中填写自己的 OpenAI-compatible API 配置。

- 在线地址：<https://bibigpt-six.vercel.app>
- GitHub：<https://github.com/weiyang02520-ops/bibigpt>
- 上游项目：<https://github.com/JimmyLv/BibiGPT>

## 当前能力

- 使用网页中填写的 API Key、Base URL 和任意兼容模型 ID。
- OpenRouter OAuth 仅作为可选配置方式。
- 优先获取平台已有字幕，不使用视频简介冒充字幕。
- 没有可访问字幕时，使用浏览器本地 Whisper 转写音频。
- Bilibili 和 YouTube 音频都通过同源 Range 代理按小块读取，不把整段视频常驻下载到浏览器内存。
- 长课程会先切分转写文本，再逐段总结并合成完整课程笔记。
- 支持关键画面预览和完整 Obsidian Vault ZIP：课程索引、课程笔记、逐段转写、复习材料、图片和 manifest。
- 可用稳定 lesson ID 更新已有 Vault；未知文件和用户编辑会保留，冲突的新版本写入 `.bibigpt-new`。
- 课程任务会保存在当前浏览器 IndexedDB，刷新后可继续。
- API Key 保存在当前浏览器的 localStorage，不写入项目或结果缓存。
- 个人 BYOK 请求没有购买、License 或每日次数限制。
- Supabase、Upstash、Segment、Sentry 和服务端模型 Key 均为可选配置。

## 使用

1. 打开在线地址。
2. 填写 API Key 和 API Base URL。
3. 填写模型服务支持的模型 ID。
4. 粘贴哔哩哔哩或 YouTube 视频链接并点击“一键总结”。
5. 使用“新建 Vault”下载独立知识库；后续使用“更新 Vault”选择旧 ZIP，安全合并同一课程或加入新课程。

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

- `BILIBILI_SESSION_TOKEN`：部分 B 站字幕或媒体信息需要登录态才能访问。
- `OPENAI_COMPATIBLE_API_KEY`：可选服务端 Key；个人部署通常留空。
- `OPENAI_COMPATIBLE_BASE_URL` / `OPENAI_COMPATIBLE_MODEL`：服务端默认模型配置。
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`：可选结果缓存。
- `NEXT_PUBLIC_SITE_URL`：站点公开地址，用于页面元数据。

不要提交 `.env*`、API Key、B 站 Session Token 或其他密钥。

## 已知边界

- 本地 ASR 需要首次下载浏览器端 Whisper 模型，耗时和显存/内存占用取决于设备与网络。
- B 站字幕、音频和关键帧可能要求 `BILIBILI_SESSION_TOKEN`。
- YouTube 字幕和音频解析依赖非官方接口，平台策略变化时可能失效。
- YouTube 暂未实现关键画面保存；Obsidian ZIP 中的图片目前主要来自 Bilibili sprite。
- 长课程可分段处理，但 20 小时以上课程仍建议按视频/章节分批运行，避免浏览器任务过长。

## 验证

```powershell
npx prettier --check .
npx tsc --noEmit
npm run build
```

本分支基于 BibiGPT v1 修改，继续遵循仓库中的 GPL-3.0 许可证。
