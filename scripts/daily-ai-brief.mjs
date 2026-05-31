import crypto from "node:crypto";
import process from "node:process";

const { FEISHU_WEBHOOK_URL, FEISHU_SIGN_SECRET, DRY_RUN } = process.env;

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date();
const since = new Date(now.getTime() - DAY_MS);

const sourceFeeds = [
  {
    name: "OpenAI",
    url: "https://openai.com/news/rss.xml",
    category: "official",
  },
  {
    name: "Anthropic",
    url: "https://www.anthropic.com/news/rss.xml",
    category: "official",
  },
  {
    name: "Google AI",
    url: "https://blog.google/technology/ai/rss/",
    category: "official",
  },
  {
    name: "Microsoft AI",
    url: "https://www.microsoft.com/en-us/ai/blog/feed/",
    category: "official",
  },
  {
    name: "Meta AI",
    url: "https://ai.meta.com/blog/rss/",
    category: "official",
  },
];

const importantTerms = [
  "launch",
  "release",
  "announce",
  "introduce",
  "model",
  "agent",
  "api",
  "open source",
  "benchmark",
  "safety",
  "research",
  "reasoning",
  "multimodal",
  "video",
  "audio",
  "coding",
  "developer",
  "enterprise",
  "gpt",
  "claude",
  "gemini",
  "llama",
  "grok",
  "diffusion",
  "robot",
  "chip",
  "nvidia",
  "ai",
  "llm",
];

const productTerms = [
  "launch",
  "release",
  "api",
  "app",
  "platform",
  "model",
  "agent",
  "tool",
  "beta",
  "preview",
];

const escapeXml = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();

const between = (text, tag) => {
  const match = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? escapeXml(match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")) : "";
};

const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "daily-ai-brief-bot/1.0",
      Accept: "application/rss+xml, application/atom+xml, application/json, text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseFeed(xml, source) {
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ];

  return blocks
    .map(([block]) => {
      const title = between(block, "title");
      const link =
        between(block, "link") ||
        block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1]?.trim() ||
        "";
      const published =
        parseDate(between(block, "pubDate")) ||
        parseDate(between(block, "published")) ||
        parseDate(between(block, "updated")) ||
        parseDate(between(block, "dc:date"));
      const summary = between(block, "description") || between(block, "summary") || between(block, "content");

      return {
        title,
        link,
        published,
        summary,
        source: source.name,
        category: source.category,
      };
    })
    .filter((item) => item.title && item.link && item.published && item.published >= since);
}

async function fetchFeedItems(source) {
  try {
    const xml = await fetchText(source.url);
    return parseFeed(xml, source);
  } catch (error) {
    console.warn(`Skipped ${source.name}: ${error.message}`);
    return [];
  }
}

async function fetchHackerNewsItems() {
  const createdAfter = Math.floor(since.getTime() / 1000);
  const queries = ["AI", "LLM", "OpenAI", "Anthropic", "Gemini", "Claude", "Hugging Face"];
  const items = [];

  for (const query of queries) {
    try {
      const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(
        query,
      )}&numericFilters=created_at_i>${createdAfter}&hitsPerPage=10`;
      const data = JSON.parse(await fetchText(url));

      for (const hit of data.hits ?? []) {
        const title = hit.title || hit.story_title;
        const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
        if (!title || !link) continue;

        items.push({
          title,
          link,
          published: parseDate(hit.created_at),
          summary: `${hit.points ?? 0} points, ${hit.num_comments ?? 0} comments on Hacker News.`,
          source: "Hacker News",
          category: "discussion",
          scoreBoost: Math.min(25, Math.floor((hit.points ?? 0) / 20) + Math.floor((hit.num_comments ?? 0) / 10)),
        });
      }
    } catch (error) {
      console.warn(`Skipped Hacker News query ${query}: ${error.message}`);
    }
  }

  return items.filter((item) => item.published && item.published >= since);
}

async function fetchHuggingFacePapers() {
  try {
    const html = await fetchText("https://huggingface.co/papers");
    const matches = [...html.matchAll(/href=["'](\/papers\/\d+\.\d+)["'][^>]*>([^<]{8,180})</gi)];
    const seen = new Set();

    return matches
      .map((match) => ({
        title: escapeXml(match[2]),
        link: `https://huggingface.co${match[1]}`,
        published: now,
        summary: "Hugging Face Papers trending page item.",
        source: "Hugging Face Papers",
        category: "paper",
        scoreBoost: 8,
      }))
      .filter((item) => {
        const key = item.link;
        if (seen.has(key)) return false;
        seen.add(key);
        return item.title && importantTerms.some((term) => item.title.toLowerCase().includes(term));
      })
      .slice(0, 5);
  } catch (error) {
    console.warn(`Skipped Hugging Face Papers: ${error.message}`);
    return [];
  }
}

function scoreItem(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  let score = item.scoreBoost ?? 0;

  if (item.category === "official") score += 30;
  if (item.category === "paper") score += 12;
  if (item.category === "discussion") score += 5;

  for (const term of importantTerms) {
    if (text.includes(term)) score += 3;
  }

  if (/\b(gpt|claude|gemini|llama|grok)\b/i.test(text)) score += 8;
  if (/\b(release|launch|announce|introduce|open source|api|agent|model)\b/i.test(text)) score += 8;

  return score;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.link.replace(/[?#].*$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function whyItMatters(item) {
  if (item.category === "official") {
    return "来自官方来源，通常代表产品、模型、研究或平台策略的直接变化，适合优先关注。";
  }

  if (item.category === "paper") {
    return "出现在 Hugging Face Papers 热榜，说明研究社区正在集中讨论这个方向。";
  }

  return "Hacker News 上出现较高讨论度，适合观察开发者社区对该 AI 议题的即时反馈。";
}

function suitableFor(item) {
  const text = item.title.toLowerCase();
  if (text.includes("api") || text.includes("developer") || text.includes("agent")) {
    return "开发者、AI 产品团队、自动化工作流团队。";
  }
  if (text.includes("paper") || text.includes("research") || item.category === "paper") {
    return "研究人员、模型评测团队、关注前沿论文的人。";
  }
  if (text.includes("enterprise") || text.includes("business")) {
    return "企业 AI 负责人、业务自动化团队、采购和治理团队。";
  }
  return "AI 从业者、产品经理、内容创作者和技术决策者。";
}

function practicalUse(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  if (!productTerms.some((term) => text.includes(term))) {
    return "";
  }

  if (text.includes("api") || text.includes("agent")) {
    return "可能的实际用法：接入现有应用、构建自动化 agent、改造内部流程工具。";
  }

  if (text.includes("video") || text.includes("image") || text.includes("audio")) {
    return "可能的实际用法：生成或编辑多媒体内容，用于营销、教学、演示和创意制作。";
  }

  if (text.includes("model")) {
    return "可能的实际用法：替换或补充现有模型能力，用于问答、检索、代码、内容生成或分析任务。";
  }

  return "可能的实际用法：作为新工具或平台能力，试用于个人效率、内容生产或团队自动化。";
}

function buildBrief(items) {
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);

  const selected = dedupe(items)
    .map((item) => ({ ...item, score: scoreItem(item) }))
    .filter((item) => item.category !== "discussion" || (item.scoreBoost ?? 0) >= 3)
    .filter((item) => item.score >= 12)
    .sort((a, b) => b.score - a.score || b.published - a.published)
    .slice(0, 5);

  if (selected.length === 0) {
    return `AI 每日简报（免费版）\n时间：${date}\n\n今日未发现高可信重要更新。\n\n总结：今天 AI 领域没有从公开来源捕捉到足够高可信、值得单独推送的重大更新。`;
  }

  const lines = [`AI 每日简报（免费版）`, `时间：${date}`, ""];

  selected.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`来源链接：${item.link}`);
    lines.push(`发生了什么：${item.source} 在过去 24 小时内发布或出现了这条更新/讨论。${item.summary ? `摘要：${item.summary}` : ""}`);
    lines.push(`为什么值得关注：${whyItMatters(item)}`);
    lines.push(`可能适合谁使用：${suitableFor(item)}`);
    const usage = practicalUse(item);
    if (usage) lines.push(usage);
    lines.push("");
  });

  lines.push("总结：今天 AI 领域最值得关注的趋势是，官方模型/平台更新与开发者社区讨论仍在共同推动 agent、多模态和模型工程落地。");
  return lines.join("\n");
}

async function sendToFeishu(text) {
  if (DRY_RUN === "1") {
    console.log("\nDRY_RUN=1, skipped Feishu delivery.");
    return false;
  }

  if (!FEISHU_WEBHOOK_URL) {
    throw new Error("Missing FEISHU_WEBHOOK_URL");
  }

  const payload = {
    msg_type: "text",
    content: { text },
  };

  if (FEISHU_SIGN_SECRET) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const stringToSign = `${timestamp}\n${FEISHU_SIGN_SECRET}`;
    payload.timestamp = timestamp;
    payload.sign = crypto.createHmac("sha256", stringToSign).update("").digest("base64");
  }

  const response = await fetch(FEISHU_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Feishu request failed: ${response.status} ${body}`);
  }

  const json = JSON.parse(body);
  if (json.code !== 0 && json.StatusCode !== 0) {
    throw new Error(`Feishu returned an error: ${body}`);
  }

  return true;
}

const items = [
  ...(await Promise.all(sourceFeeds.map(fetchFeedItems))).flat(),
  ...(await fetchHackerNewsItems()),
  ...(await fetchHuggingFacePapers()),
];

const brief = buildBrief(items);
console.log(brief);
if (await sendToFeishu(brief)) {
  console.log("Sent to Feishu.");
}
