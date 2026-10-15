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

/** 运行一条任务,返回 { ok, answer, usage, steps, denied } */
function runTask(task) {
  return new Promise((resolveRun) => {
    // 直接以 node + tsx loader 启动 harness CLI:
    // 进程 cwd 必须是任务目标仓库(agent 的工作目录 = process.cwd()),
    // 而 CLI 脚本本身位于 harness 仓库。--json 输出逐行运行事件,
    // 从中累计 usage 与工具调用数。
    const args = [
      '--import', 'file:///D:/deepseek-harness/node_modules/tsx/dist/loader.mjs',
      'D:/deepseek-harness/apps/cli/src/bin.ts',
      'headless',
      '--json',
      ...(mode === 'governed' ? ['--patch', PATCH] : []),
      task.prompt,
    ]
    const child = spawn('node', args, {
      cwd: CWD,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      resolveRun({ ok: false, answer: '(timeout)', usage: null, steps: null, denied: 0 })
    }, 10 * 60 * 1000)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', (code) => {
      clearTimeout(timeout)
      const parsed = parseJsonStream(stdout)
      resolveRun({
        ok: code === 0,
        answer: parsed.finalText,
        usage: parsed.usage,
        steps: parsed.toolCalls,
        denied: parsed.denied,
      })
    })
  })
}

/**
 * 解析 --json 事件流:累计 token 用量、工具调用数与拦截次数,
 * 提取最终回复文本。
 */
function parseJsonStream(stdout) {
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  let toolCalls = 0
  let denied = 0
  let finalText = ''
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type === 'status' && ev.phase === 'step_end' && ev.usage) {
      usage.inputTokens += ev.usage.inputTokens ?? 0
      usage.outputTokens += ev.usage.outputTokens ?? 0
      usage.totalTokens += ev.usage.totalTokens ?? 0
    } else if (ev.type === 'tool_call') {
      toolCalls += 1
    } else if (ev.type === 'tool_result' && (ev.isError || ev.error)) {
      denied += 1
    } else if (ev.type === 'final') {
      finalText = ev.text ?? ''
    }
  }
  return {
    usage,
    toolCalls,
    denied,
    finalText,
  }
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
    promptTokens: r.usage?.inputTokens ?? 0,
    completionTokens: r.usage?.outputTokens ?? 0,
    steps: r.steps,
    denied: r.denied,
  })
}

writeFileSync(outPath, results.map(r => JSON.stringify(r)).join('\n') + '\n')
const okCount = results.filter(r => r.ok).length
console.log(`完成: ${okCount}/${results.length} 通过 → ${outPath}`)
console.log('下一步: node eval/analyze.mjs <baseline.jsonl> <governed.jsonl>')
