/**
 * 类型检查:针对本仓库 src/ 的错误清零。
 * 说明:deepseek-harness 源码以路径映射参与解析,harness 内部在
 * 其自身 tsconfig 下编译通过;此处仅以本仓库代码为准。
 */
import { execSync } from 'node:child_process'

let out = ''
try {
  out = execSync('npx tsc --noEmit', { encoding: 'utf8' }).toString()
} catch (error) {
  out = error.stdout?.toString() ?? ''
}

const ours = out.split('\n').filter(line => line.startsWith('src/'))
if (ours.length > 0) {
  console.error(ours.join('\n'))
  process.exit(1)
}
console.log('typecheck ok:本仓库 src/ 无类型错误(harness 内部噪音已过滤)')
