---
name: wechat-article-extractor
description: 提取并总结微信公众号文章（mp.weixin.qq.com）。在用户给出公众号链接、需要标题/作者/正文/摘要时使用。带本地宽松限流，避免大规模抓取触发微信 1004。
whenToUse: 用户粘贴一条微信公众号文章链接，需要阅读、提炼或总结时。不要对一长串链接批量连抓。
---

# 微信公众号文章提取

从微信公众号文章 URL（`mp.weixin.qq.com`）提取元数据与正文，供总结与提炼。

## 硬性限流（本地强制 + 你必须遵守）

脚本侧已强制（宽松默认）：

| 规则 | 值 |
|------|-----|
| 每小时最多 URL 抓取 | **8** 篇 |
| 两次 URL 抓取最小间隔 | **20** 秒 |
| 遇到 1004 / 本地限流拒绝后 | 额外冷却约 **15** 分钟 |

你还必须遵守：

1. **一次只处理用户点名的链接**；不要主动展开「相关阅读」批量抓取。
2. 用户一次贴多条 URL 时：**先确认是否逐条处理**，并按间隔排队；宁可少抓，也不要连发请求。
3. 收到 `code: 1004` 或文案含「访问过于频繁 / 本地限流」时：**立刻停止**，告知用户稍后再试，不要重试轰炸。
4. 仅传入 HTML、不再发网络请求时，不受 URL 限流计数。

首次在本机使用前，若依赖未安装，在本 skill 目录执行：

```bash
npm install
```

（桌面端随 DMG 种子到 `~/.dsh/skills/wechat-article-extractor/` 时一般已带好依赖。）

## 用法

```javascript
const { extract } = require('./scripts/extract.js');

const result = await extract('https://mp.weixin.qq.com/s?__biz=...');
// 成功: { done: true, code: 0, data: {...} }
// 限流/失败: { done: false, code: 1004, msg: '...' }
```

从已有 HTML 解析（不计入 URL 限流）：

```javascript
const result = await extract(html, { url: sourceUrl });
```

### 选项

```javascript
await extract(url, {
  shouldReturnContent: true,
  shouldReturnRawMeta: false,
  shouldFollowTransferLink: true,
  shouldExtractMpLinks: false,   // 保持 false，避免连带抓取
  shouldExtractTags: false,
  shouldExtractRepostMeta: false
});
```

## 成功时请这样回复用户

1. 标题、公众号、作者、发布时间
2. 3–8 条要点提炼
3. 可选：一段简短总结
4. 原文链接

不要整页粘贴 HTML。

## 常见错误码

| Code | 含义 |
|------|------|
| 1004 | 访问过于频繁（平台或本地限流） |
| 1001 | 无法获取文章信息 |
| 1002 | 请求失败 |
| 2002 | 链接已过期 |
| 2005 | 内容已删除 |
| 2009 | 不支持的链接 |

## 依赖

`cheerio`、`dayjs`、`request-promise`、`qs`、`lodash.unescape`（见 `package.json`）。
