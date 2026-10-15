/**
 * context-governor —— DeepSeek Harness 上下文治理插件
 *
 * 三个能力:
 * 1. 按需工具裁剪:agent/pre-step 时按任务画像 restrict() 掉无关工具,
 *    减少工具描述对上下文的占用;
 * 2. 分层权限闸门:tools/pre-execute 瀑布上按"工具名 + 参数路径"分级
 *    返回 allow / ask / deny,约束文件改写与命令执行范围;
 * 3. 分层工具结果剪枝:提供 ctx.toolResultPruner 服务,超预算的工具结果
 *    按"任务目标关键词"分层保留相关内容。
 *
 * @module context-governor
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Config, resolveConfig, type ResolvedConfig } from './config.ts'
import { attachToolFilter } from './tool-filter.ts'
import { attachGuard } from './guard.ts'
import { HierarchicalPruner } from './pruner.ts'

export const name = 'context-governor'

export const inject = ['tools'] as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    contextGovernor: ContextGovernor
  }
}

export class ContextGovernor extends Service {
  static inject = inject

  static Config: z<Config> = Config

  readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'contextGovernor')
    this.resolved = resolveConfig(config)
    attachToolFilter(ctx, this.resolved.toolFilter)
    attachGuard(ctx, this.resolved.guard)
    if (this.resolved.pruner.enabled) {
      new HierarchicalPruner(ctx, this.resolved.pruner)
    }
  }
}

export default ContextGovernor

// 导出核心逻辑与配置,便于单测与外部复用
export * from './core/classify.ts'
export * from './core/danger.ts'
export * from './core/prune.ts'
export * from './config.ts'
