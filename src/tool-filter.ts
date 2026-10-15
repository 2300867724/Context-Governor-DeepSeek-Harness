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

  // restrict 作用于"调用方所在的 agent 作用域":监听器在 agent 作用域内
  // 派发时,通过外层 ctx.tools 调用即可命中当前作用域。
  const tools = ctx.tools

  ctx.on('agent/pre-step', async function (payload, next) {
    try {
      const text = payload.messages.map(extractText).join('\n')
      const profile = classifyTask(text, config.profiles)
      if (profile) {
        const deny = computeDenyList(profile, config.knownTools)
        if (deny.length > 0) {
          tools.restrict({ deny })
        }
      }
    } catch (error) {
      // 裁剪失败绝不能中断轮次:记录后放行
      ctx.logger.warn('context-governor: tool filter failed, passing through:', error)
    }
    return next()
  })
}
