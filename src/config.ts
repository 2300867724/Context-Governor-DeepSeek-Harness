/**
 * 插件配置:Schema 校验 + 默认值合并。
 * 运行期由 dsh 用 Schemastery 校验插件配置,此处提供类型与解析函数。
 */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PROFILES, type TaskProfile } from './core/classify.ts'
import { DEFAULT_POLICY, type GateDecision } from './core/danger.ts'
import { DEFAULT_PRUNE_CONFIG } from './core/prune.ts'

/** 工具裁剪配置 */
export const ToolFilterConfig = z.object({
  enabled: z.boolean().default(true),
  /** 任务画像,顺序即优先级 */
  profiles: z.array(z.object({
    id: z.string(),
    keywords: z.array(z.string()),
    denyTools: z.array(z.string()),
  })).default(DEFAULT_PROFILES),
  /** 已知全局工具名列表(用于把画像 deny 模式转成精确名;也可留空由内置名兜底) */
  knownTools: z.array(z.string()).default([]),
})

/** 权限闸门配置 */
export const GuardConfig = z.object({
  enabled: z.boolean().default(true),
  /** 工作区根路径;为空表示不做边界检查,仅按工具名分级 */
  workspaceRoots: z.array(z.string()).default([]),
  readOutside: z.union(['allow', 'ask', 'deny'] as const).default(DEFAULT_POLICY.readOutside),
  write: z.union(['allow', 'ask', 'deny'] as const).default(DEFAULT_POLICY.write),
  command: z.union(['allow', 'ask', 'deny'] as const).default(DEFAULT_POLICY.command),
})

/** 分层剪枝配置 */
export const PrunerConfig = z.object({
  enabled: z.boolean().default(true),
  threshold: z.number().step(1).min(100).default(DEFAULT_PRUNE_CONFIG.threshold),
  head: z.number().step(1).min(0).default(DEFAULT_PRUNE_CONFIG.head),
  tail: z.number().step(1).min(0).default(DEFAULT_PRUNE_CONFIG.tail),
  goalKeywords: z.array(z.string()).default(DEFAULT_PRUNE_CONFIG.goalKeywords),
})

/** 插件总配置 */
export const Config = z.object({
  toolFilter: ToolFilterConfig.default({}),
  guard: GuardConfig.default({}),
  pruner: PrunerConfig.default({}),
})

// 注:schemastery 的 d.ts 中同名 type/const 遮蔽导致 z.infer 不可用,
// 输入类型改为手写(与 schema 保持同步)。
export type Config = {
  toolFilter?: {
    enabled?: boolean
    profiles?: TaskProfile[]
    knownTools?: string[]
  }
  guard?: {
    enabled?: boolean
    workspaceRoots?: string[]
    readOutside?: GateDecision
    write?: GateDecision
    command?: GateDecision
  }
  pruner?: {
    enabled?: boolean
    threshold?: number
    head?: number
    tail?: number
    goalKeywords?: string[]
  }
}

export interface ResolvedConfig {
  toolFilter: {
    enabled: boolean
    profiles: TaskProfile[]
    knownTools: string[]
  }
  guard: {
    enabled: boolean
    workspaceRoots: string[]
    readOutside: GateDecision
    write: GateDecision
    command: GateDecision
  }
  pruner: {
    enabled: boolean
    threshold: number
    head: number
    tail: number
    goalKeywords: string[]
  }
}

/** 合并用户配置与默认值(Schemastery 加载期已校验,这里只做结构兜底) */
export function resolveConfig(config: Partial<Config> = {}): ResolvedConfig {
  const tf = config.toolFilter ?? {}
  const g = config.guard ?? {}
  const p = config.pruner ?? {}
  return {
    toolFilter: {
      enabled: tf.enabled ?? true,
      profiles: tf.profiles ?? DEFAULT_PROFILES,
      knownTools: tf.knownTools ?? [],
    },
    guard: {
      enabled: g.enabled ?? true,
      workspaceRoots: g.workspaceRoots ?? [],
      readOutside: g.readOutside ?? DEFAULT_POLICY.readOutside,
      write: g.write ?? DEFAULT_POLICY.write,
      command: g.command ?? DEFAULT_POLICY.command,
    },
    pruner: {
      enabled: p.enabled ?? true,
      threshold: p.threshold ?? DEFAULT_PRUNE_CONFIG.threshold,
      head: p.head ?? DEFAULT_PRUNE_CONFIG.head,
      tail: p.tail ?? DEFAULT_PRUNE_CONFIG.tail,
      goalKeywords: p.goalKeywords ?? [],
    },
  }
}
