/**
 * Write the empty vault files required before sidecar ingest.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/bootstrap-vault
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** DeepSeek profile written into every new vault. Do not add `/v1`. */
export const BOOTSTRAP_CONFIG_TOML = `version = 1
[llm]
default_profile = "deepseek"
[llm.profiles.deepseek]
base_url = "https://api.deepseek.com"
model = "deepseek-v4-flash"
api_key_env = "DEEPSEEK_API_KEY"
`

const AGENTS_MD = `---
title: AGENTS
page_type: schema
lang: zh
role: schema
---

# 知识库

不要用手改 \`.octopus-kb/\`。入库和检索只走桌面「知识库」入口。
`

const INDEX_MD = `---
title: INDEX
page_type: index
lang: zh
role: index
---

# 索引

还没有词条。
`

const LOG_MD = `---
title: LOG
page_type: log
lang: zh
role: log
---

# 日志
`

/**
 * Create the empty vault tree and DeepSeek config.
 * @param vaultDir - absolute library directory.
 * @returns after files exist.
 */
export async function bootstrapVault(vaultDir: string): Promise<void> {
  await mkdir(join(vaultDir, 'wiki'), { recursive: true })
  await mkdir(join(vaultDir, 'raw'), { recursive: true })
  await mkdir(join(vaultDir, '.octopus-kb'), { recursive: true })
  await writeFile(join(vaultDir, 'AGENTS.md'), AGENTS_MD, 'utf8')
  await writeFile(join(vaultDir, 'wiki', 'INDEX.md'), INDEX_MD, 'utf8')
  await writeFile(join(vaultDir, 'wiki', 'LOG.md'), LOG_MD, 'utf8')
  await writeFile(join(vaultDir, '.octopus-kb', 'config.toml'), BOOTSTRAP_CONFIG_TOML, 'utf8')
}
