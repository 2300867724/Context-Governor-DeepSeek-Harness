/**
 * 分层工具结果剪枝(dsh 适配层):
 * 提供 ctx.toolResultPruner 服务。与官方 head/middle/tail 剪枝不同,
 * 中段按"任务目标关键词"分层保留相关内容,压缩与目标无关的冗长输出。
 *
 * 服务接口与官方 dsh-compaction-tool-result-pruner 对齐
 * (measureContent / pruneContent / pruneSession),便于 compaction-basic
 * 在压缩前自动调用。会话重写遵循 shadow-price 记账协议。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, ToolResultMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-token-meter'
import { codePointLength, pruneText } from './core/prune.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    toolResultPruner: HierarchicalPruner
  }
}

/** 剪枝服务配置 */
export interface HierarchicalPrunerConfig {
  threshold: number
  head: number
  tail: number
  goalKeywords: string[]
}

/** 剪枝产出(与官方 PruneResult 对齐) */
export interface PruneEntry {
  readonly originalSeq: number
  readonly replacementSeq: number
  readonly charsBefore: number
  readonly charsAfter: number
}

export interface PruneResult {
  readonly pruned: readonly PruneEntry[]
  readonly charsRemoved: number
}

export class HierarchicalPruner extends Service {
  static inject = ['tokenMeter']

  readonly config: HierarchicalPrunerConfig

  constructor(ctx: Context, config: HierarchicalPrunerConfig) {
    super(ctx, 'toolResultPruner')
    this.config = config
  }

  /** 统计文本块总字符数(Unicode code point) */
  measureContent(blocks: readonly ContentBlock[]): number {
    let chars = 0
    for (const block of blocks) {
      if (block.type === 'text') chars += codePointLength(block.text)
    }
    return chars
  }

  /**
   * 对工具结果内容做分层剪枝。
   * 纯文本逐块剪枝;非文本块(图片/富文本)原样保留。
   * @returns 剪枝后的内容;未超阈值返回 null
   */
  pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null {
    if (this.measureContent(blocks) <= this.config.threshold) return null

    const pruned: ContentBlock[] = []
    let changed = false
    for (const block of blocks) {
      if (block.type !== 'text') {
        pruned.push(block)
        continue
      }
      const out = pruneText(block.text, this.config)
      if (out !== null) {
        pruned.push({ ...block, text: out })
        changed = true
      } else {
        pruned.push(block)
      }
    }
    return changed ? pruned : null
  }

  /**
   * 遍历当前 surface 中所有超预算的 tool/result,落地替换。
   * 与官方剪枝器一致:替换前追加 shadow-price 记账事件,替换携带
   * surfaceOp/sourceEventSeqs 供纯消费者回放。
   */
  pruneSession(session: Session): PruneResult {
    const pruned: PruneEntry[] = []
    let charsRemoved = 0
    for (const seq of [...session.surface.nodes]) {
      // 与官方剪枝器相同的 deprecated 访问路径(session.eventAt)
      const event = session.eventAt(seq)
      if (event?.type !== 'tool/result') continue

      const original = session.deriveEventMessage(event) as ToolResultMessage
      const content = this.pruneContent(original.content)
      if (content === null) continue

      const charsBefore = this.measureContent(original.content)
      const charsAfter = this.measureContent(content)
      const message = freezeMessage<ToolResultMessage>({
        ...original,
        content,
      })
      // Shadow-price 协议:记账事件与替换紧邻追加,纯消费者可据此扣减
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original),
      })
      const replacement = session.append('tool/result', {
        ...event.data,
        message,
      }, {
        surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
        sourceEventSeqs: [seq],
      })
      pruned.push({
        originalSeq: seq,
        replacementSeq: replacement.seq,
        charsBefore,
        charsAfter,
      })
      charsRemoved += charsBefore - charsAfter
    }
    return { pruned, charsRemoved }
  }
}
