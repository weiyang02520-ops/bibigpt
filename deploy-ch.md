# Vercel 部署说明

## 1. 导入仓库

1. 在 GitHub Fork 或使用当前仓库 `weiyang02520-ops/bibigpt`。
2. 登录 Vercel，选择 **Add New Project**。
3. 导入 GitHub 仓库，Framework Preset 选择 Next.js。
4. 保持默认构建命令 `npm run build`，点击 Deploy。

个人 BYOK 模式在没有 Supabase、Upstash 和服务端模型 Key 时也能构建和运行。

## 2. 可选环境变量

在 Vercel 项目的 **Settings -> Environment Variables** 中按需添加：

```text
NEXT_PUBLIC_SITE_URL=https://你的正式域名
BILIBILI_SESSION_TOKEN=
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_MODEL=gpt-4o-mini
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

说明：

- 网页中填写自己的 Key 时，不需要 `OPENAI_COMPATIBLE_API_KEY`。
- 只有部分 B 站字幕需要 `BILIBILI_SESSION_TOKEN`；不要把 Token 提交到 GitHub。
- Upstash 只用于可选结果缓存，不负责个人 BYOK 次数限制。
- YouTube 字幕不再使用 SaveSubs，无需 `SAVESUBS_X_AUTH_TOKEN`。

修改环境变量后应重新部署。

## 3. 验收

部署完成后至少检查：

1. 首页显示 API Key、Base URL、模型 ID 和视频链接输入框。
2. 页面没有“免费次数”“购买次数”或 License Key 文案。
3. 未填写 API Key 时，接口立即返回清晰的 400 错误。
4. 无字幕视频返回 422，且不调用模型。
5. 有字幕视频能逐块显示模型总结。
6. `/privacy` 能正常打开。

## 4. 安全边界

- 生产环境只允许公网 HTTPS 模型 Base URL。
- 浏览器 Key 会经过当前 Vercel API 路由转发，因此只在自己信任的部署中使用。
- 如果配置服务端 Key 并公开分享站点，应额外增加独立的访问控制或限流；当前个人版不包含商业计次逻辑。
