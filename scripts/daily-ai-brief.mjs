import crypto from "node:crypto";
import process from "node:process";
import OpenAI from "openai";

const {
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-5",
  FEISHU_WEBHOOK_URL,
  FEISHU_SIGN_SECRET,
  DRY_RUN,
} = process.env;

if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

const now = new Date();
const today = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  dateStyle: "full",
  timeStyle: "short",
}).format(now);

const prompt = `
请整理过去 24 小时内 AI 领域最值得关注的更新。当前时间：${today}，时区：Asia/Shanghai。

优先查看以下公开来源：
- OpenAI、Anthropic、Google DeepMind、Meta AI、Microsoft AI、xAI 官方博客或公告
- Hugging Face trending / papers / spaces
- Product Hunt AI 分类
- Hacker News 热门 AI 相关讨论
- 重要 AI 工具或模型发布新闻

输出要求：
1. 只保留 5 条以内真正重要的信息。
2. 每条包含：标题、来源链接、发生了什么、为什么值得关注、可能适合谁使用。
3. 如果是产品或模型更新，说明它可能带来的实际用法。
4. 不要编造信息；找不到可靠来源就写“今日未发现高可信重要更新”。
5. 最后给出一句总结：今天 AI 领域最值得关注的趋势是什么。
6. 用中文输出，适合直接发送到飞书群。
7. 每条来源链接必须是可点击 URL，并优先使用官方或一手来源。
`.trim();

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

const response = await client.responses.create({
  model: OPENAI_MODEL,
  reasoning: { effort: "medium" },
  tools: [
    {
      type: "web_search_preview",
      user_location: {
        type: "approximate",
        country: "CN",
        city: "Shanghai",
        region: "Shanghai",
        timezone: "Asia/Shanghai",
      },
    },
  ],
  tool_choice: "auto",
  input: prompt,
});

const brief = response.output_text?.trim();

if (!brief) {
  throw new Error("OpenAI returned an empty brief");
}

console.log(brief);

if (DRY_RUN === "1") {
  console.log("\nDRY_RUN=1, skipped Feishu delivery.");
  process.exit(0);
}

if (!FEISHU_WEBHOOK_URL) {
  throw new Error("Missing FEISHU_WEBHOOK_URL");
}

const payload = {
  msg_type: "text",
  content: {
    text: brief,
  },
};

if (FEISHU_SIGN_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${FEISHU_SIGN_SECRET}`;
  const sign = crypto
    .createHmac("sha256", stringToSign)
    .update("")
    .digest("base64");

  payload.timestamp = timestamp;
  payload.sign = sign;
}

const feishuResponse = await fetch(FEISHU_WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const feishuText = await feishuResponse.text();

if (!feishuResponse.ok) {
  throw new Error(`Feishu request failed: ${feishuResponse.status} ${feishuText}`);
}

let feishuJson;
try {
  feishuJson = JSON.parse(feishuText);
} catch {
  feishuJson = null;
}

if (feishuJson && feishuJson.code !== 0 && feishuJson.StatusCode !== 0) {
  throw new Error(`Feishu returned an error: ${feishuText}`);
}

console.log("Sent to Feishu.");
