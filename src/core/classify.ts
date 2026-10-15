/**
 * 任务画像分类:根据用户消息的关键词命中情况,将任务归类到预设画像。
 * 纯函数实现,不依赖 dsh,便于独立单测与复现。
 */

/** 任务画像:一类任务的工具集裁剪策略 */
export interface TaskProfile {
  /** 画像标识,如 read-only / coding */
  id: string
  /** 命中任意一个关键词即认为任务属于该画像 */
  keywords: string[]
  /** 该画像下需要从可见工具集中移除的工具名(精确名或 glob:前缀* ) */
  denyTools: string[]
}

/** 内置画像:只读型任务裁剪全部写入/命令类工具 */
export const DEFAULT_PROFILES: TaskProfile[] = [
  {
    id: 'read-only',
    keywords: [
      '查看', '检索', '搜索', '阅读', '分析', '理解', '定位', '排查',
      '解释', '总结', '梳理', '阅读代码', '看看', '了解',
    ],
    denyTools: [
      // dsh 内置工具的真实名称(headless/web profile)
      'write', 'edit', 'bash', 'pwsh', 'job_kill',
    ],
  },
]

/** glob 匹配:支持 `prefix*`(前缀)与精确名 */
export function matchesTool(toolName: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    return toolName.startsWith(pattern.slice(0, -1))
  }
  return toolName === pattern
}

/**
 * 将任务文本归类到画像。
 * @param message - 用户消息文本(多个消息拼接)
 * @param profiles - 画像列表,顺序即优先级
 * @returns 命中的画像;未命中返回 null(表示不裁剪)
 */
export function classifyTask(message: string, profiles: TaskProfile[]): TaskProfile | null {
  let best: TaskProfile | null = null
  let bestScore = 0
  for (const profile of profiles) {
    let score = 0
    for (const kw of profile.keywords) {
      if (message.includes(kw)) score += 1
    }
    if (score > bestScore) {
      best = profile
      bestScore = score
    }
  }
  return bestScore > 0 ? best : null
}

/** 计算需要 deny 的工具名集合(画像 deny 模式 ∩ 已知工具名) */
export function computeDenyList(profile: TaskProfile, knownTools: string[]): string[] {
  return knownTools.filter(name => profile.denyTools.some(pattern => matchesTool(name, pattern)))
}
