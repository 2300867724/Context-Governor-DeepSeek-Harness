/**
 * 评测结果分析:对比 baseline 与 governed 两份 JSONL 结果,
 * 输出 token 用量与任务完成率对比表。
 *
 * 结果文件格式(每行一条):
 *   { "taskId": "ro-01", "ok": true, "promptTokens": 1234, "completionTokens": 567,
 *     "steps": 6, "denied": 0 }
 *
 * 用法:node eval/analyze.mjs <baseline.jsonl> <governed.jsonl>
 */
import { readFileSync } from 'node:fs'

function load(path) {
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line))
  return rows
}

function stats(rows) {
  const n = rows.length
  const sum = key => rows.reduce((acc, r) => acc + (r[key] ?? 0), 0)
  const avg = key => n > 0 ? sum(key) / n : 0
  return {
    n,
    ok: rows.filter(r => r.ok).length,
    avgPrompt: avg('promptTokens'),
    avgCompletion: avg('completionTokens'),
    avgTotal: avg('promptTokens') + avg('completionTokens'),
    peakPrompt: Math.max(...rows.map(r => r.promptTokens ?? 0)),
    avgSteps: avg('steps'),
    denied: sum('denied'),
  }
}

const [basePath, govPath] = process.argv.slice(2)
if (!basePath || !govPath) {
  console.error('用法: node eval/analyze.mjs <baseline.jsonl> <governed.jsonl>')
  process.exit(1)
}

const base = stats(load(basePath))
const gov = stats(load(govPath))
const pct = (a, b) => b === 0 ? '-' : `${((a - b) / b * 100).toFixed(1)}%`

console.log(`
评测对比报告
========================================
任务数:      ${base.n} (baseline) / ${gov.n} (governed)

指标                baseline        governed        变化
--------------------------------------------------------
任务完成率          ${(base.ok / base.n * 100).toFixed(1)}%           ${(gov.ok / gov.n * 100).toFixed(1)}%           ${pct(gov.ok / gov.n, base.ok / base.n)}
平均 prompt tokens  ${base.avgPrompt.toFixed(0)}         ${gov.avgPrompt.toFixed(0)}         ${pct(gov.avgPrompt, base.avgPrompt)}
平均 completion     ${base.avgCompletion.toFixed(0)}         ${gov.avgCompletion.toFixed(0)}         ${pct(gov.avgCompletion, base.avgCompletion)}
平均总 tokens       ${base.avgTotal.toFixed(0)}         ${gov.avgTotal.toFixed(0)}         ${pct(gov.avgTotal, base.avgTotal)}
prompt 峰值         ${base.peakPrompt}         ${gov.peakPrompt}         ${pct(gov.peakPrompt, base.peakPrompt)}
平均步骤数          ${base.avgSteps.toFixed(1)}         ${gov.avgSteps.toFixed(1)}
权限拦截次数        ${base.denied}               ${gov.denied}
========================================
`)

if (gov.ok / gov.n >= base.ok / base.n) {
  console.log('✓ 任务完成率未下降')
} else {
  console.log('✗ 任务完成率下降,检查 deny 清单是否误伤工具')
}
