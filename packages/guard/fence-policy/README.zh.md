---
description: "外部数据围栏策略，供用户和维护者为选定的第三方工具结果配置结构化提示注入防护。"
kind: "package-reference"
---

# @deepseek-ai/dsh-fence-policy

[English](README.md) | 中文

## 概述

`dsh-fence-policy` 将选定第三方工具返回的文本标记为外部数据。它移除不可见格式控制符，中和结构化分隔符和角色标记形式，并用 `<external-data>` 标签包裹每个选定文本块。一个稳定的系统提示词区段要求模型把其中的文本当作数据，而不是指令。该策略随 `dsh` base bundle 交付，也仍可用于显式组合。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在工具和系统提示词服务之后挂载此策略。显式列出每个外部工具家族，并为同时包含图片或其他非文本块的结果选择文本字节上限。

```yaml
- name: '@deepseek-ai/dsh-fence-policy'
  config:
    tools: [web_fetch, web_search, 'mcp__*']
    maxMixedTextBytes: 65536
```

| 字段 | 必填 | 含义 |
|---|---|---|
| `tools` | 是 | 工具名模式；`*` 匹配任意字符序列 |
| `maxMixedTextBytes` | 是 | 结果含有非文本块时，围栏文本的 UTF-8 聚合字节上限 |

策略只处理名称匹配 `tools` 的根调用。同一 Cordis 组合中的进程内子智能体会收到未标记作用域的监听器，因此它自身的直接根调用也会被围栏。携带 `exec.parent` 的调用保持不变。

纯文本大小限制由 `dsh-spill-policy` 负责：它以前置方式注册的执行后监听器会先委托，收到完整围栏结果后再溢出或生成预览。结果只要含有非文本块，溢出策略就不会限制它，因此本包会应用 `maxMixedTextBytes`，同时将非文本块保留在原位。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`sanitizeUntrusted` 在不执行 Unicode 规范化的前提下进行一次线性扫描。它移除指定不可见码位，把不允许的 C0/C1 控制符替换为空格，仅在结构位置转义分隔符起始字符和字符引用的 `&`，并转义行首角色标记的冒号。普通比较表达式、URL 查询字符串、shell 重定向和自然语言标点保持不变。

执行后监听器先委托，再转换结果。它保留阻止决策、显式 `value` 替换、带父调用的调用、不匹配调用、非文本块及下游 `additionalContexts`。所有贡献均使用 Cordis 管理的注册，插件作用域释放时会一并移除。

| 文件 | 职责 |
|---|---|
| [`src/escape.ts`](src/escape.ts) | 纯转义、围栏和混合结果截断 |
| [`src/index.ts`](src/index.ts) | 配置、稳定提示词区段和执行后监听器 |
| — | 不发布运行时 invariant companion，因为提示词区段和结果转换均由同一插件作用域注册；包内不存在可能分歧的独立观测。 |

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 稳定解释区段

#### 模型看到的内容

挂载该策略后，每个请求都包含一个名为 `guard:external-data` 的稳定系统提示词区段。每个选定结果文本块按以下形式呈现：

##### 围栏结果

```markdown
<external-data>
<escaped third-party text>
</external-data>
```

#### Token 影响

系统区段字节稳定且只添加一次。每个选定文本块增加两行包裹文本；结构转义使结果文本最多扩展到 8 倍。纯文本结果大小仍由溢出策略管理；对于混合结果，`maxMixedTextBytes` 限制围栏文本的聚合大小，其中包括包裹文本和截断后缀。

#### KV Cache 影响

同一组合的各次请求可以复用稳定系统区段。工具结果仍是追加到对话中的内容，不会改变先前的请求字节。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

- **转发的 PTC 值**——PTC 程序把外部值转发到工具参数（包括 `subagent` 提示词）后，本策略不会追踪这类模型编写的数据流。
- **进程外子项**——SDK、ACP、Codex 和 Claude provider 使用独立组合，不在覆盖范围内。
- **Shell 与文件通道**——本包不围栏 shell 输入／输出和文件内容；防护应由各自负责的摄取点或执行点提供。
