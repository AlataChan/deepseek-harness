/**
 * Standing team templates and seat definitions.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/templates
 */

import type { TeamTemplateDefinition, TeamTemplateOrigin } from './types.ts'

/**
 * Baked-in team template definitions.
 * When a team is created from a template, these definitions are copied into editable TeamDefinition and TeamSeat instances.
 */
export const TEAM_TEMPLATES: readonly TeamTemplateDefinition[] = [
  {
    id: 'blank',
    name: '空白小队',
    nameEn: 'Blank squad',
    description: '空白团队，仅包含协调员，由用户自行按需增加成员',
    seats: [],
  },
  {
    id: 'document',
    name: '文书组',
    nameEn: 'Document squad',
    description: '文书处理流水线：资料、初稿、指标核对与审核',
    seats: [
      {
        name: 'archivist',
        title: '资料员',
        titleEn: 'Archivist',
        duty: '只收材料、建索引、列缺失项，不编数据',
        defaultCapabilities: {
          allowedTools: ['read_file', 'list_files', 'search_workspace'],
          disallowedTools: ['bash', 'run_command'],
        },
      },
      {
        name: 'drafter',
        title: '文书员',
        titleEn: 'Drafter',
        duty: '按模板出结构完整初稿；无来源章节只写「缺失项清单」',
        defaultCapabilities: {
          allowedTools: ['read_file', 'write_file', 'edit_file'],
          disallowedTools: ['bash', 'run_command'],
        },
      },
      {
        name: 'metric-checker',
        title: '指标核对员',
        titleEn: 'Metric checker',
        duty: '对照原始表核数字/单位/目标达成，出差异清单',
        defaultCapabilities: {
          allowedTools: ['read_file', 'list_files'],
          disallowedTools: ['bash', 'run_command', 'write_file'],
        },
      },
      {
        name: 'reviewer',
        title: '审核员',
        titleEn: 'Reviewer',
        duty: '查对外承诺、财务敏感、口径风险；不替机构提交资方',
        defaultCapabilities: {
          allowedTools: ['read_file'],
          disallowedTools: ['bash', 'run_command', 'write_file', 'delete_file'],
        },
      },
    ],
  },
  {
    id: 'case',
    name: '案例组',
    nameEn: 'Case squad',
    description: '案例萃取流水线：记录整理、脱敏、萃取与入库审核',
    seats: [
      {
        name: 'notetaker',
        title: '记录整理员',
        titleEn: 'Notetaker',
        duty: '忠实整理现场/访谈笔记，不润色事实',
        defaultCapabilities: {
          allowedTools: ['read_file', 'write_file'],
        },
      },
      {
        name: 'redactor',
        title: '脱敏员',
        titleEn: 'Redactor',
        duty: '去姓名手机身份证，地址不超过区县',
        defaultCapabilities: {
          allowedTools: ['read_file', 'write_file', 'edit_file'],
        },
      },
      {
        name: 'case-writer',
        title: '案例萃取员',
        titleEn: 'Case writer',
        duty: '做成标准案例卡（背景-行动-结果-手法）',
        defaultCapabilities: {
          allowedTools: ['read_file', 'write_file', 'edit_file'],
        },
      },
      {
        name: 'librarian',
        title: '入库审核员',
        titleEn: 'Librarian',
        duty: '五分类归档并更新索引，缺字段标待补',
        defaultCapabilities: {
          allowedTools: ['read_file', 'write_file', 'list_files'],
        },
      },
    ],
  },
  {
    id: 'comms',
    name: '传播部',
    nameEn: 'Comms squad',
    description: '传播内容流水线：资料汇编、结构大纲、写作与合规审核',
    seats: [
      {
        name: 'sourcer',
        title: '资料员',
        titleEn: 'Sourcer',
        duty: '汇素材与口径边界（含脱敏要求）',
        defaultCapabilities: {
          allowedTools: ['read_file', 'list_files'],
        },
      },
      {
        name: 'outliner',
        title: '结构员',
        titleEn: 'Outliner',
        duty: '定标题/提纲/段落结构',
        defaultCapabilities: {
          allowedTools: ['read_file', 'write_file'],
        },
      },
      {
        name: 'copywriter',
        title: '写作员',
        titleEn: 'Copywriter',
        duty: '出「说人话」初稿，不编成效数字',
        defaultCapabilities: {
          allowedTools: ['read_file', 'write_file', 'edit_file'],
        },
      },
      {
        name: 'compliance-reviewer',
        title: '审核员',
        titleEn: 'Compliance reviewer',
        duty: '发布前审校敏感信息与过度承诺；不代发微信/平台',
        defaultCapabilities: {
          allowedTools: ['read_file'],
          disallowedTools: ['bash', 'run_command', 'delete_file'],
        },
      },
    ],
  },
]

/**
 * Look up a team template by identifier.
 * @param id - template origin identifier.
 * @returns template definition if found, undefined otherwise.
 */
export function getTeamTemplate(id: TeamTemplateOrigin): TeamTemplateDefinition | undefined {
  return TEAM_TEMPLATES.find(t => t.id === id)
}
