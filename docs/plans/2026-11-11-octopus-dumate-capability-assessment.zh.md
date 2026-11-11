# Octopus、百度搭子与 AgentBridge：能力对照

[English](2026-11-11-octopus-dumate-capability-assessment.md) | 中文

<a id="summary"></a>
## 摘要

Octopus 与材料中的智能体执行能力有明显重合，但现有证据不足以认定它已等同于百度搭子的企业运营管控平台，或 AgentBridge 的业务应用开发与发布平台。建议定位为基于 DeepSeek Harness 开发的可定制本地化 Agent 工作台，尤其适合具备研发与集成验收能力的团队。

<a id="contents"></a>
## 目录

- [证据与版本范围](#scope)
- [值得借鉴的介绍结构](#structure)
- [详细能力矩阵](#matrix)
- [关键差距与验收条件](#gaps)
- [定位与推进建议](#position)
- [仓库证据索引](#evidence)
- [维护说明](#dev-note)

<a id="scope"></a>
## 证据与版本范围

源码核对始于2026年11月10日，11月11日完成整理。材料为用户提供的51页百度搭子私有化企业版介绍与16页 AgentBridge 介绍。下文页码从PDF封面开始计为第1页。厂商功能、客户规模、认证和提效数字均为材料中的陈述，本次没有独立验证其产品实现或基准结果。

仓库范围：检查 `feature/im-expansion-tui-local-qualification` 工作区，并只读检查 `master` 上已合并的新功能。当前工作区含未提交改动，且落后于 `master`；不能把此目录中缺少主分支新增包，直接算成产品缺失。桌面操作、工作树审查和 Agent-Reach 均以主分支清单与README为依据。本次评估不切换分支、不合并、不部署，也不修改产品代码。

“已有”表示存在相关实现，不代表完整兑现厂商承诺或通过安装包验收。“部分”表示基础机制存在，但范围、集成或治理不同。“未证实”表示检查到的实现不能证明具备对应产品能力，不等于穷尽所有分支与外部服务后的不存在证明。“集成项”表示需要按部署开发适配器或做专项验收。

本会话此前观察到的服务器微信分发测试属于特定环境集成：定时触发生产器与worker后，朋友圈和私信均获得已验证回执。这不代表 Octopus 桌面安装包原生提供通用微信能力，也不代表生产SLA或企业客户案例。本次对照没有新增运行时、模型、Windows或多用户验收。

<a id="structure"></a>
## 值得借鉴的介绍结构

搭子材料的有效顺序是：业务变化与痛点（4—9页）、产品全景（11—13页）、个人助理与岗位数字员工（15—21页）、可复用资产（23—30页）、企业治理（32—36页）、部署（38—40页）、证据与场景（41—49页），最后是FAQ（50页）。值得借鉴的是从客户问题推进到交付证据的叙事顺序；正文、承诺与图示均应自行编写。

AgentBridge 补充了另一条故事线：存量系统的障碍（2—3页）、业务系统与AI能力之间的增强层（4—7页）、与RPA和通用智能体的分维度比较（8页）、场景/方案/证据成对展示（9—14页），以及现场交付方法（15页）。应学习具体流程关联与交付纪律，不照搬客户标识、量化收益或尚未证实的端到端确定性承诺。

保留材料自身的限定：技能与安全中心能力按需开通或受交付版本限制（23、35页）；外部模型与工具接入需另行评估数据流向（33、50页）；仅客户端模式不要求其云端智能体计算节点（39页）。不能拿想象中的全部默认开启配置来作比较。

<a id="matrix"></a>
## 详细能力矩阵

D为搭子材料，A为 AgentBridge 材料；证据编号对应下方仓库索引。

| 编号 | 能力与材料页码 | 判断 | Octopus 实现与实际差异 | 证据 |
| --- | --- | --- | --- | --- |
| 01 | 桌面与网页入口；D20—21 | 已有 | 已有Tauri桌面与Web Host/Client；不等于企业统一身份或跨设备状态同步。 | E01 |
| 02 | 私有或兼容模型接入；D13、33 | 已有 | 模型适配器支持兼容网关及自托管端点；模型、GPU与离线依赖仍需单独部署和验收。 | E02 |
| 03 | 主备模型自动接管；D33 | 未证实 | 多路由与模型选择不等于自动故障切换；可通过外部网关补足，但需验证任务连续性与工具调用兼容性。 | E02 |
| 04 | 规划、工具、代码与文件交付；D17—18 | 已有 | 核心执行、文件、shell、成果物与SDK具备基础；输出质量及业务验收仍需按场景验证。 | E01 |
| 05 | 人工澄清与持久问题；D17、35 | 已有 | 持久问题支持过期与认证回答排队；所选预设须挂载工具，不等于企业审批流程引擎。 | E03 |
| 06 | 多智能体协作；D12、18、27 | 已有 | 已有命名队友、持久消息、共享任务与常驻团队；原生Team共享工作区，工作树插件不自动让每个队友获得独立目录。 | E04,E12 |
| 07 | 长任务故障连续性；D18 | 部分 | Goal和会话状态可持久化，但自动续跑权限限于当前进程；状态保存不证明重启自动续跑或外部动作只执行一次。 | E05 |
| 08 | 定时执行与通知；D20、49 | 已有 | Schedule及经验证的服务器服务可触发工作；执行主机须在线，投递与业务完成需各自的回执。 | E05,E06 |
| 09 | 飞书、钉钉与企微入口；D20、50 | 部分 | 桌面设置与服务器服务支持飞书/钉钉，需显式凭证与身份绑定；未证实具备相同的原生企业微信集成。 | E06 |
| 10 | 多入口统一身份与会话；D20 | 部分 | 桌面IM自由文本进入绑定的IM会话，决策按钮回到原问题；不等于通用跨设备会话无缝接力。 | E03,E06 |
| 11 | 个人助理与可复用岗位；D15—16 | 已有 | 已有持久助手档案、角色提示、作用域记忆、模型选择和保存的团队；这是可复用配置，不是组织账号目录。 | E04 |
| 12 | 数字员工工号与组织治理；D15—16 | 部分 | 命名助手不等于独立工号、邮箱、服务账号及组织授权/停用；这些仍需企业集成。 | E04,E06 |
| 13 | 编写与加载Skills；D23 | 已有 | 已有技能加载、内置技能和自开发插件；技能属于指导文本，必须执行的动作限制仍要由工具与策略落实。 | E07 |
| 14 | 企业技能广场与组织分发；D23、30 | 部分 | 已有profile插件安装与固定包清单；未证实具备按部门授权、逐次发布审批及全企业分发/撤回。 | E07 |
| 15 | 技能多引擎检测与可信源治理；D23、35 | 未证实 | 插件管理器的审批与包信息检查不等于恶意代码或提示词注入检测中心；安装脚本可能执行代码。 | E07,E10 |
| 16 | MCP工具与资源接入；D24 | 已有 | MCP客户端可发现工具/资源并连接配置的服务；协议客户端本身不提供现成ERP/CRM业务语义或凭证。 | E08 |
| 17 | 集中凭证托管与企业工具授权；D24 | 部分 | 已有凭证引用、授权流程与工具策略；租户级凭证库、轮换、组织授权及不泄露保证仍需专项建设/验收。 | E08,E10 |
| 18 | 本地知识与文档检索；D25 | 已有 | 问知识可导入支持的文档、保存原件并检索页/片段与关键词；OCR完整性与格式限制仍须说明。 | E09 |
| 19 | 企业知识库权限与检索控制台；D25 | 部分 | 个人文库不等于组织/用户组ACL、语义/混合/重排序配置及集中上线前命中测试控制台。 | E09,E10 |
| 20 | 集中文件库与成果归属；D26 | 部分 | 已有工作区浏览、附件与会话成果物；未证实具备配额、授权及只接收有来源成果的企业共享文件库。 | E01,E09 |
| 21 | 角色与团队持久记忆；D19、27 | 已有 | 已有带版本号的作用域条目、提示注入与受限的逐轮记忆回顾；不等于组织级记忆治理。 | E04 |
| 22 | 管理端记忆回滚与Dreaming；D19、27 | 部分 | 条目修订号与会话抽取不等于已验收的历史回滚界面或历史任务离线Dreaming服务。 | E04 |
| 23 | 自动评测优化并发布Harness；D19 | 未证实 | 测试、快照和自进化指导是研发资产；未证实存在同等的自动评测到审核发布运行时的产品闭环。 | E01,E04 |
| 24 | 数据与电商工作台；D9、44、48 | 已有 | 问数据可导入支持的表格；电商支持固定本地表与暂存CSV导出，默认不执行真实ERP/店铺交易或任意联表。 | E09 |
| 25 | 开发与专业智能体生态；D12—13、44 | 部分 | Cordis插件、Host/Client扩展与SDK支持二次开发；未证实具备同等无代码企业设计器或已集成的百度Comate/秒哒等专业智能体生态。 | E01,E07 |
| 26 | 读取和操作现有业务网页；D28；A5—7 | 部分 | 浏览器provider和主分支专用桌面操作预设提供基础动作；能力受provider、平台、权限与目标系统验收限制。 | E11,E12 |
| 27 | 网页按钮、侧栏与URL规则插件；D28；A6—7 | 未证实 | 未证实具备按站点注入、版本管理、启停和撤回业务UI插件的同等运行时；浏览器自动化不能直接代替。 | E11,E12 |
| 28 | 录制回放与可视化应用编排；D28；A6 | 未证实 | 代码可自动执行已知步骤，但未证实具备面向业务人员的录制器、复用流程编辑器与已验收回放生命周期。 | E01,E11 |
| 29 | 页面/API/SQL融合的跨系统应用；D28—29；A5—7 | 集成项 | MCP、shell、浏览器和本地数据工具可支撑定制应用；业务适配器、登录策略、数据规范、回填与失败恢复仍需建设和验收。 | E08,E09,E11 |
| 30 | 确定性低Token业务执行；D28；A8 | 部分 | 固定脚本可减少重复推理，但不能普遍承诺LLM驱动流程确定、业务UI稳定或外部动作只发生一次。 | E01,E05,E11 |
| 31 | 应用审批、组织发布与负责人运营；D30；A6 | 未证实 | 安装profile包不等于具备审核、组织可见性、版本历史与撤回能力的企业应用商店。 | E07,E12 |
| 32 | 企业SSO与账号开通；D11—12、32、50 | 未证实 | 已有IM操作人认证与本地设置；未证实具备同等企业身份提供方/组织目录同步与账号开通后台。 | E06,E10 |
| 33 | 组织级RBAC与资源授权；D25、32、35 | 部分 | 已有工作区/会话策略、助手作用域与租户绑定，但不是覆盖部门、用户组、用户及所有共享资产的企业权限模型。 | E04,E06,E10 |
| 34 | 弹性实例池、配额与休眠唤醒；D34、38 | 未证实 | 团队/回合预算与服务资源限制属于局部控制，不构成员工实例集群的弹性调度器。 | E04,E06 |
| 35 | 链路追踪与运营看板；D32、36 | 部分 | 已有会话日志、轨迹、用量和可选遥测；未证实具备企业DAA/DAV、组织/资源看板和集中可搜索审计产品。 | E13 |
| 36 | 完整审计保留与取证治理；D35—36 | 部分 | 模型可见动作留痕具有证据价值，但不能证明存储不可篡改、所有OS/网络/插件动作均记录，或具备企业保留周期与访问治理。 | E10,E13 |
| 37 | 逐任务内存/文件/网络隔离；D18、35 | 部分 | 平台沙箱可约束配置的执行路径；本地沙箱共享宿主内核/文件系统，部分执行约束和未受限provider路径必须如实披露。 | E10 |
| 38 | 注入防护、DLP与集中技能安全；D23、35 | 部分 | 已有审批、guard、作用域和局部密钥筛查；不等于集中防注入/DLP检测套件或所有插件安全保证。 | E04,E07,E10 |
| 39 | Linux私有服务器与IM隔离；D38—39 | 已有 | 已有显式profile、入口/租户分离和systemd部署示例；单机运行成功不证明多节点高可用，也不代表Linux具备全部桌面功能。 | E06 |
| 40 | Kubernetes集群运维与统一升级；D38—39 | 未证实 | 桌面打包与插件生命周期不证明具备同等集群控制平面、多副本运行及全量实例灰度/回滚治理。 | E01,E06,E07 |
| 41 | 信创适配认证与基准背书；D40—42 | 未证实 | 未证实具备对应认证或独立基准结果；源码可移植不等于认证，厂商案例数字不能变成我们的成绩。 | E01 |
| 42 | 媒体/社交平台发现与读取 | 主分支已有 | Agent-Reach主分支默认轻量植入，在已验收的macOS Apple Silicon上按需安装依赖；排除发布/私信，不替代AgentBridge。 | E12 |

<a id="gaps"></a>
## 关键差距与验收条件

- 企业治理：用不同用户组的两个用户，证明UI、IM、SDK、继承会话和工具均不能越权读取对方受保护的知识、凭证与成果。须覆盖撤销授权与反向测试，不能只展示组织树截图。
- AgentBridge式集成：在真实目标系统验证URL规则、登录态归属、版本化脚本、回填校验、页面变化后的失败行为与发布回滚。能点击页面的浏览器智能体只是执行基础，不是完整产品。
- 私有运行：逐项验证模型、搜索、浏览器、MCP、遥测、安装依赖及IM的真实网络路径，明确哪些必须出网、哪些完全内网运行。部署位置本身不能建立保密性或插件信任。
- 运行可靠性：测试掉线、进程/主机重启、人工决策过期、回执丢失与外部写入不确定。保留未知状态并防止危险重复提交，区分保存目标与持久续跑授权。
- 商业证据：功能演示和内部集成须如实标注；获得具体场景用户验收与基线测量后，再陈述节省时间、客户覆盖、行业成熟度或合同服务等级。

<a id="position"></a>
## 定位与推进建议

建议表述：“Octopus 是基于 DeepSeek Harness 开源项目开发的本地化 Agent 工作台。团队可以检查代码、选择模型端点、开发插件，并验证自己的执行与数据策略。”不要声称已经等同搭子的完整企业套件、内网部署必然安全，或所有厂商生态都不够开放。

客户交流可使用[介绍脚本](2026-11-11-octopus-enterprise-introduction.zh.md)。主线是业务适配、可见工作台、能力复用、明确的数据/执行选择与可验收试点。浏览器集成模块仍按提案说明；只有客户需要集中多用户部署时，再把组织治理平台列为独立建设范围。

学习现场交付方法，但不承诺通用工期：选择一条流程，盘查真实数据和权限，开发最小连接器，观察用户操作，修复实际失败，再交接插件、配置、测试与责任清单。扩展之前先约定验收指标。

<a id="evidence"></a>
## 仓库证据索引

- **E01 — 架构、受支持SDK、桌面载体与许可：** [docs/architecture.md](../../docs/architecture.zh.md); [sdk/README.md](../../packages/sdk/README.zh.md); [desktop/README.md](../../apps/desktop/README.md); [LICENSE](../../LICENSE)
- **E02 — 模型协议适配与本地/自定义路由：** [llm-pi-ai/README.md](../../packages/llm/llm-pi-ai/README.zh.md); [llm-deepseek/README.md](../../packages/llm/llm-deepseek/README.zh.md)
- **E03 — 持久问题、预设挂载与飞书回调路由：** [session-decisions/README.md](../../packages/experimental/session-decisions/README.zh.md); [src/index.ts](../../packages/experimental/session-decisions/src/index.ts)
- **E04 — 团队归属、助手档案、记忆条目与受限回顾：** [agent-team/README.md](../../packages/experimental/agent-team/README.zh.md); [assistant-registry/README.md](../../packages/experimental/assistant-registry/README.zh.md); [src/types.ts](../../packages/experimental/assistant-registry/src/types.ts); [src/review-prediction.ts](../../packages/experimental/assistant-registry/src/review-prediction.ts)
- **E05 — Goal续跑与Schedule投递语义：** [goal/README.md](../../packages/goal/goal/README.zh.md); [schedule/README.md](../../packages/schedule/schedule/README.zh.md)
- **E06 — 桌面IM与管理员部署的服务器profile：** [desktop-im/README.md](../../packages/experimental/desktop-im/README.zh.md); [im-feishu/README.md](../../packages/experimental/im-feishu/README.zh.md); [im-service-bundle/README.md](../../packages/experimental/im-service-bundle/README.zh.md); [examples/README.md](../../packages/experimental/im-feishu/examples/README.zh.md)
- **E07 — 技能、安装器权限与桌面固定包清单：** [skill/README.md](../../packages/skill/README.zh.md); [plugin-manager/README.md](../../packages/boot/plugin-manager/README.zh.md); [src/tools.ts](../../packages/boot/plugin-manager/src/tools.ts); [scripts/desktop-profile-plugins.json](../../scripts/desktop-profile-plugins.json)
- **E08 — MCP发现、凭证与授权流程：** [mcp-client/README.md](../../packages/mcp/mcp-client/README.zh.md); [credentials/README.md](../../packages/credentials/credentials/README.zh.md); [authorization/README.md](../../packages/credentials/authorization/README.zh.md)
- **E09 — 本地文库、表格导入、固定电商模型与工作区浏览：** [desktop-ask-knowledge/README.md](../../packages/experimental/desktop-ask-knowledge/README.zh.md); [desktop-ask-data/README.md](../../packages/experimental/desktop-ask-data/README.zh.md); [commerce-mode/README.md](../../packages/experimental/commerce-mode/README.zh.md); [desktop-files/README.md](../../packages/experimental/desktop-files/README.zh.md)
- **E10 — 沙箱约束范围与策略归属：** [sandbox-local/README.md](../../packages/sandbox/sandbox-local/README.zh.md); [sandbox-policy/README.md](../../packages/sandbox/sandbox-policy/README.zh.md)
- **E11 — 浏览器归属与provider选择：** [browser-use/README.md](../../packages/browser-use/browser-use/README.zh.md); [browser-use-runtime/README.md](../../packages/experimental/browser-use-runtime/README.zh.md)
- **E13 — 持久会话、用量与有限遥测导出：** [session-persistence-jsonl/README.md](../../packages/session/session-persistence-jsonl/README.zh.md); [session-stats/README.md](../../packages/session/session-stats/README.zh.md); [session-telemetry-otel/README.md](../../packages/session/session-telemetry-otel/README.zh.md)
- **E12 — 主分支新增项：** 已只读检查 `git show master:packages/experimental/desktop-operation/README.md`、`git show master:packages/experimental/worktree-review/README.md`、`git show master:packages/experimental/agent-reach/README.md` 与 `git show master:scripts/desktop-profile-plugins.json`。这些包不在当前目录；源码与植入清单存在不等于本次新增了安装平台验收。

<a id="dev-note"></a>
## 维护说明

本文是带日期的对照参考与介绍文案依据，不是产品实施计划或安全认证。不要将厂商幻灯片、美术素材、客户身份或业绩数字直接搬进 Octopus 介绍。原始材料保留在仓库外，仓库文档仅保留页码引用，提取与渲染证据保留为本地工作资料。
