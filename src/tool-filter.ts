/**
 * 按需工具裁剪(dsh 适配层):
 * 在 agent/pre-step 时读取已领取的用户消息,按任务画像调用 tools.restrict()
 * 把无关工具从该 agent 作用域的可见集中移除,减少工具描述对上下文的占用。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { classifyTask, computeDenyList } from './core/classify.ts'
import type { ResolvedConfig } from './config.ts'
// 类型侧导入:拉入 dsh-agent 对 Events 的声明合并(agent/pre-step 等)
import type {} from '@deepseek-ai/dsh-agent'

/** 从消息内容中提取纯文本 */
function extractText(message: UserMessage): string {
  const blocks = message.content as ContentBlock[]
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n')
}

/**
 * 注册任务画像驱动的工具裁剪监听器。
 * 监听器挂在 agent/pre-step 瀑布上,始终调用 next(),只做限制、不拦截请求。
 */
export function attachToolFilter(ctx: Context, config: ResolvedConfig['toolFilter']): void {
  if (!config.enabled) return

  // 每个 agent 当前生效的裁剪 disposer。restrict() 必须在 agent 作用域内
  // 调用(scopeOf(ctx) 必须能解析出 agent),因此使用 payload.agent.ctx;
  // 每步先撤销上一步的限制再重新计算,避免限制累积。
  const restrictions = new WeakMap<object, () => void>()

  ctx.on('agent/pre-step', async function (payload, next) {
    try {
      const previous = restrictions.get(payload.agent)
      previous?.()
      restrictions.delete(payload.agent)

      const text = payload.messages.map(extractText).join('\n')
      const profile = classifyTask(text, config.profiles)
      if (profile) {
        // 以运行时实际注册的工具为准:restrict() 遇到未注册的名字会整体抛错
        // (不同平台工具集不同,如 Windows 只有 pwsh、Linux 只有 bash)。
        const visible = new Set(payload.agent.ctx.tools.schemas().map(s => s.name))
        const candidates = config.knownTools.length > 0 ? config.knownTools : [...visible]
        const deny = computeDenyList(profile, candidates).filter(name => visible.has(name))
        if (deny.length > 0) {
          // restrict 必须在 agent 作用域内调用:使用 agent.ctx
          restrictions.set(payload.agent, payload.agent.ctx.tools.restrict({ deny }))

        }
      }
    } catch (error) {
      // 裁剪失败绝不能中断轮次:记录后放行
      ctx.logger.warn('context-governor: tool filter failed, passing through:', error)
    }
    return next()
  })
}
