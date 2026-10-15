/**
 * 分层工具结果剪枝:在字符预算内保留"任务目标相关"的内容。
 * 策略:头尾按预算保留;中段只保留命中目标关键词的行,其余以标记替换。
 * 纯函数实现,不依赖 dsh,便于独立单测与复现。
 */

export const PRUNE_MARKER = '…[中间内容已压缩]…'

/** 剪枝配置 */
export interface PruneConfig {
  /** 超过该字符数才触发剪枝 */
  threshold: number
  /** 头部保留预算(字符数,近似按每行 100 字符折算行数) */
  head: number
  /** 尾部保留预算 */
  tail: number
  /** 任务目标关键词:中段命中这些词的行会被保留 */
  goalKeywords: string[]
}

export const DEFAULT_PRUNE_CONFIG: PruneConfig = {
  threshold: 8000,
  head: 1200,
  tail: 1200,
  goalKeywords: [],
}

const CHARS_PER_LINE = 100

/** 计算单行与任务目标的关联度(命中关键词数) */
export function lineScore(line: string, keywords: string[]): number {
  let score = 0
  for (const kw of keywords) {
    if (kw.length > 0 && line.includes(kw)) score += 1
  }
  return score
}

/**
 * 对文本做分层剪枝。
 * @param text - 原始工具结果文本
 * @param cfg - 剪枝配置
 * @returns 剪枝后的文本;未超阈值或剪枝后不更短时返回 null
 */
export function pruneText(text: string, cfg: PruneConfig): string | null {
  if (text.length <= cfg.threshold) return null

  const lines = text.split('\n')
  const headLines = Math.max(1, Math.round(cfg.head / CHARS_PER_LINE))
  const tailLines = Math.max(1, Math.round(cfg.tail / CHARS_PER_LINE))

  // 行数不够分层时直接按长度粗切,不做关键词保留
  if (lines.length <= headLines + tailLines + 2) {
    return null
  }

  const head = lines.slice(0, headLines)
  const tail = lines.slice(lines.length - tailLines)
  const middle = lines.slice(headLines, lines.length - tailLines)

  const keptMiddle = middle.filter(line => lineScore(line, cfg.goalKeywords) > 0)
  const droppedCount = middle.length - keptMiddle.length

  const parts: string[] = [...head]
  if (droppedCount > 0) {
    parts.push(keptMiddle.length > 0
      ? `${PRUNE_MARKER}(已压缩 ${droppedCount} 行无关内容,保留 ${keptMiddle.length} 行目标相关内容)`
      : `${PRUNE_MARKER}(已压缩 ${droppedCount} 行)`)
    parts.push(...keptMiddle)
  } else {
    parts.push(...middle)
  }
  parts.push(...tail)

  const out = parts.join('\n')
  return out.length < text.length ? out : null
}

/** 统计文本字符数(Unicode code point) */
export function codePointLength(text: string): number {
  return Array.from(text).length
}
