/**
 * 核心逻辑纯函数单测(不依赖 dsh,直接 node --test 运行)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyTask, computeDenyList, matchesTool, DEFAULT_PROFILES } from '../src/core/classify.ts'
import { computeDanger, decide, extractPaths, isInsideAny, normalizePath, DEFAULT_POLICY } from '../src/core/danger.ts'
import { pruneText, lineScore, codePointLength } from '../src/core/prune.ts'

test('matchesTool:精确名与 glob 前缀', () => {
  assert.equal(matchesTool('bash', 'bash'), true)
  assert.equal(matchesTool('bash', 'bash*'), true)
  assert.equal(matchesTool('bash_tool', 'bash*'), true)
  assert.equal(matchesTool('write_file', 'bash*'), false)
})

test('classifyTask:只读画像命中与优先级', () => {
  const p = classifyTask('帮我查看一下这个项目的结构并总结', DEFAULT_PROFILES)
  assert.ok(p)
  assert.equal(p.id, 'read-only')
  const none = classifyTask('你好', DEFAULT_PROFILES)
  assert.equal(none, null)
})

test('classifyTask:关键词命中数更高者胜出', () => {
  const profiles = [
    { id: 'a', keywords: ['x'], denyTools: [] },
    { id: 'b', keywords: ['x', 'y'], denyTools: [] },
  ]
  assert.equal(classifyTask('x y', profiles)?.id, 'b')
})

test('computeDenyList:画像 deny 模式转精确名', () => {
  const deny = computeDenyList(DEFAULT_PROFILES[0]!, ['bash', 'read_file', 'write_file', 'grep'])
  assert.deepEqual(deny, ['bash', 'write_file'])
})

test('computeDanger:命令 > 写入 > 越界读 > 安全读', () => {
  const roots = ['D:/workspace']
  assert.equal(computeDanger({ toolName: 'bash', paths: [], workspaceRoots: roots }), 'command')
  assert.equal(computeDanger({ toolName: 'write_file', paths: ['D:/workspace/a.ts'], workspaceRoots: roots }), 'write')
  assert.equal(computeDanger({ toolName: 'read_file', paths: ['C:/secret/x.txt'], workspaceRoots: roots }), 'read-outside')
  assert.equal(computeDanger({ toolName: 'read_file', paths: ['D:/workspace/a.ts'], workspaceRoots: roots }), 'safe')
})

test('isInsideAny / normalizePath', () => {
  assert.equal(isInsideAny('D:/workspace/a/b.ts', ['D:/workspace']), true)
  assert.equal(isInsideAny('D:/workspace', ['D:/workspace']), true)
  assert.equal(isInsideAny('D:/other/x.ts', ['D:/workspace']), false)
  assert.equal(isInsideAny('C:\\secret\\x.ts', ['D:/workspace']), false)
  assert.equal(isInsideAny('anything', []), true)
  assert.equal(normalizePath('D:\\workspace\\'), 'D:/workspace')
})

test('decide:策略映射', () => {
  assert.equal(decide('safe', DEFAULT_POLICY), 'allow')
  assert.equal(decide('command', DEFAULT_POLICY), 'ask')
  assert.equal(decide('write', { ...DEFAULT_POLICY, write: 'deny' }), 'deny')
})

test('extractPaths:递归提取参数中的路径', () => {
  const args = {
    file_path: '/home/user/a.ts',
    dirs: ['D:/work/src', 'not a path'],
    nested: { target: './config.json' },
    num: 42,
  }
  const paths = extractPaths(args)
  assert.deepEqual(paths, ['/home/user/a.ts', 'D:/work/src', './config.json'])
})

test('pruneText:超阈值才剪枝', () => {
  const cfg = { threshold: 50, head: 20, tail: 20, goalKeywords: [] }
  assert.equal(pruneText('短文本', cfg), null)
})

test('pruneText:分层保留头尾与目标行', () => {
  const lines = []
  for (let i = 0; i < 40; i++) lines.push(`普通日志行 ${i}`)
  lines.splice(15, 0, 'ERROR: 目标函数执行失败,堆栈如下')
  const text = lines.join('\n')
  const cfg = { threshold: 100, head: 100, tail: 100, goalKeywords: ['目标函数'] }
  const out = pruneText(text, cfg)
  assert.ok(out)
  assert.ok(out.includes('普通日志行 0'))
  assert.ok(out.includes('普通日志行 39'))
  assert.ok(out.includes('目标函数执行失败'), '目标相关行必须保留')
  assert.ok(out.includes('已压缩'), '必须包含压缩标记')
  assert.ok(out.length < text.length)
})

test('lineScore / codePointLength', () => {
  assert.equal(lineScore('包含错误信息的一行', ['错误', '无关']), 1)
  assert.equal(codePointLength('ab😀c'), 4)
})
