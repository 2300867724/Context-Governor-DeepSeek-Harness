/**
 * 分层权限闸门(dsh 适配层):
 * 监听 tools/pre-execute 瀑布,按"工具名 + 参数路径"计算危险级别,
 * 对照配置策略返回 allow / ask / deny。
 */
import type { Context } from '@deepseek-ai/cordis'
import { computeDanger, decide, extractPaths, isInsideAny, type DangerLevel } from './core/danger.ts'
import type { ResolvedConfig } from './config.ts'
// 类型侧导入:拉入 dsh-tools 对 Events 的声明合并(tools/pre-execute 等)
import type {} from '@deepseek-ai/dsh-tools'

/** 危险级别对应的中文原因说明(出现在审批/拒绝消息里) */
function reasonText(danger: DangerLevel, outside: boolean): string {
  switch (danger) {
    case 'command':
      return '执行命令类操作需要确认'
    case 'write':
      return '写入/修改文件类操作需要确认'
    case 'read-outside':
      return outside
        ? '读取工作区外路径需要确认'
        : '读取操作超出授权范围'
    case 'safe':
      return ''
  }
}

/**
 * 注册分层权限闸门监听器。
 * 以 prepend 注册,确保硬闸先于其他 pre-execute 监听器执行。
 */
export function attachGuard(ctx: Context, config: ResolvedConfig['guard']): void {
  if (!config.enabled) return

  const policy = {
    readOutside: config.readOutside,
    write: config.write,
    command: config.command,
  }

  ctx.on('tools/pre-execute', async function (exec, next) {
    const toolName: string = exec.name
    const args: unknown = exec.arguments
    if (!toolName) return next()

    const paths = extractPaths(args)
    const danger = computeDanger({ toolName, paths, workspaceRoots: config.workspaceRoots })
    const outside = paths.some(p => !isInsideAny(p, config.workspaceRoots))
    const decision = decide(danger, policy)

    switch (decision) {
      case 'allow':
        return next()
      case 'ask':
        return { kind: 'ask', reason: `[context-governor] ${reasonText(danger, outside)}` }
      case 'deny':
        return { kind: 'deny', reason: `[context-governor] ${reasonText(danger, outside)}` }
    }
  }, true)
}
