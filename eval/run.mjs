/**
 * 评测 runner:逐任务调用 dsh headless,验收结果并记录 token 统计。
 *
 * 用法:
 *   node eval/run.mjs baseline eval/tasks/read-only.jsonl eval/results/ro-baseline.jsonl
 *   node eval/run.mjs governed eval/tasks/read-only.jsonl eval/results/ro-governed.jsonl
 *
 * 模式:
 *   baseline - 不加载本插件
 *   governed - 加载 eval/cordis.eval.yml(工具裁剪+剪枝开,闸门放行)
 *
 * 前置条件:
 *   - D:/deepseek-harness 已 pnpm install && pnpm run build
 *   - 环境变量 DEEPSEEK_API_KEY 已设置
 *   - 工作目录为 D:/context-governor(任务都针对本仓库)
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [mode, tasksPath, outPath] = process.argv.slice(2)
if (!['baseline', 'governed'].includes(mode) || !tasksPath || !outPath) {
  console.error('用法: node eval/run.mjs <baseline|governed> <tasks.jsonl> <output.jsonl>')
  process.exit(1)
}

const PATCH = resolve('eval/cordis.eval.yml')
const HARNESS = 'D:/deepseek-harness'
const CWD = resolve('.')

const tasks = readFileSync(tasksPath, 'utf8').split('\n').filter(l => l.trim()).map(JSON.parse)
console.log(`模式: ${mode} | 任务数: ${tasks.length} | 输出: ${outPath}`)

mkdirSync(join(outPath, '..'), { recursive: true })

/** 运行一条任务,返回 { ok, answer, usage } */
function runTask(task) {
  return new Promise((resolveRun) => {
    const args = mode === 'governed'
      ? ['pnpm', 'dsh', 'headless', '--patch', PATCH, task.prompt]
      : ['pnpm', 'dsh', 'headless', task.prompt]
    const child = spawn('npx', args, {
      cwd: CWD,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      resolveRun({ ok: false, answer: '(timeout)', usage: null })
    }, 10 * 60 * 1000)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', (code) => {
      clearTimeout(timeout)
      const text = (stdout + '\n' + stderr)
      const usage = parseUsage(text)
      resolveRun({
        ok: code === 0,
        answer: stdout.slice(-2000),
        usage,
      })
    })
  })
}

/** 从输出中粗提取 token 用量(headless 输出格式以实际为准,取不到记 null) */
function parseUsage(text) {
  const m = text.match(/usage[^\n]*/i)
    ?? text.match(/(promptTokens|prompt_tokens|input_tokens)[^\n]*/i)
  if (!m) return null
  const nums = m[0].match(/\d+/g)?.map(Number) ?? []
  return { promptTokens: nums[0] ?? null, completionTokens: nums[1] ?? null }
}

/** 验收答案 */
function checkAccept(task, answer) {
  const a = task.accept
  if (!a) return true
  if (a.kind === 'contains') {
    return a.must.every(kw => answer.includes(kw))
  }
  if (a.kind === 'grep') {
    try {
      const content = readFileSync(resolve(a.file), 'utf8')
      return content.includes(a.pattern)
    } catch {
      return false
    }
  }
  return true
}

const results = []
for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i]
  process.stdout.write(`[${i + 1}/${tasks.length}] ${task.taskId} ... `)
  const r = await runTask(task)
  const ok = r.ok && checkAccept(task, r.answer)
  console.log(ok ? '✓' : '✗')
  results.push({
    taskId: task.taskId,
    ok,
    promptTokens: r.usage?.promptTokens ?? 0,
    completionTokens: r.usage?.completionTokens ?? 0,
    steps: null,
    denied: 0,
  })
}

writeFileSync(outPath, results.map(r => JSON.stringify(r)).join('\n') + '\n')
const okCount = results.filter(r => r.ok).length
console.log(`完成: ${okCount}/${results.length} 通过 → ${outPath}`)
console.log('下一步: node eval/analyze.mjs <baseline.jsonl> <governed.jsonl>')
