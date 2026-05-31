# Daily AI Brief to Feishu

每天北京时间 9 点自动抓取过去 24 小时 AI 领域公开来源更新，并发送到飞书群。

## 工作方式

- GitHub Actions 在云端定时运行，所以电脑关机、Codex 没打开也能执行。
- 免费版不调用 OpenAI API，不需要 OpenAI 额度。
- 脚本抓取公开 RSS、Hacker News、Hugging Face Papers 等来源，并用规则筛选生成中文简报。
- 脚本通过飞书群自定义机器人 Webhook 发送消息。

## 你需要准备

1. 一个 GitHub 仓库，把本目录内容推上去。
2. 一个飞书群自定义机器人 Webhook。
3. 如果飞书机器人开启了签名校验，还需要机器人 Secret。

## GitHub 配置

进入 GitHub 仓库：

`Settings` -> `Secrets and variables` -> `Actions`

添加 Repository secrets：

- `FEISHU_WEBHOOK_URL`
- `FEISHU_SIGN_SECRET`，如果飞书机器人没开签名校验，可以不填。

## 测试

在 GitHub 仓库的 `Actions` 页面，打开 `Daily AI Brief to Feishu`，点击 `Run workflow` 手动运行一次。

## 本地检查

```powershell
npm install
npm run check
```

如果只想本地生成简报但不发飞书：

```powershell
$env:DRY_RUN="1"
npm run brief
```
