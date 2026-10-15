# 量化评测方案

目标:为插件的三个能力产出可复现的量化数据,支撑简历中的数字描述。

## 评测任务集

自建 30-50 题编码任务集(`eval/tasks/`),每题为「任务描述 + 初始仓库 + 验收脚本」三件套:

- **只读型任务**(10-15 题):查看/检索/定位/总结类,验收 = 答案字符串匹配
- **修改型任务**(10-15 题):改 bug / 加功能类,验收 = 测试用例通过
- **多轮长任务**(10 题):需要 10+ 轮工具调用的重构任务,用于压测剪枝

任务难度分为 easy / medium / hard,保证基线完成率有区分度(避免全对/全错)。

## 对照实验

每组实验:同一任务集 × { 插件关闭 | 插件开启 },固定模型与 profile,各跑一遍:

| 指标 | 采集方式 | 对应简历表述 |
|---|---|---|
| 单任务平均 token 用量 | `ctx.tokenMeter` / dsh 会话日志统计 | "单任务平均 token 占用降低约 XX%" |
| 工具描述占用占比 | 开启裁剪前后,首次请求中 tool schema 段 token 数 | "无关工具描述占用降低约 XX%" |
| 长任务上下文峰值 | 多轮任务中请求上下文的 token 峰值 | "长会话上下文压缩约 XX%" |
| 任务完成率 | 验收脚本通过率对比 | "任务完成率不下降" |
| 权限拦截次数 | guard 日志中 ask/deny 计数,人工核对无误报 | "分级权限拦截 XX 次越界操作" |

## 复现步骤

```bash
# 1. 准备任务集(JSONL:任务描述 + 验收命令)
# 2. 基线跑分(插件关闭)
pnpm dsh run --profile headless --task eval/tasks/read-only.jsonl --out eval/results/baseline.jsonl
# 3. 插件开启跑分
pnpm dsh run --profile headless --patch cordis.patch.yml --task eval/tasks/read-only.jsonl --out eval/results/governed.jsonl
# 4. 汇总对比
node eval/analyze.mjs baseline.jsonl governed.jsonl
```

(`run --task` 的准确参数名以 dsh CLI 实际为准,使用前先 `pnpm dsh run --help` 核对。)

## 结果记录

| 实验(只读任务组) | 基线 | 开启插件 | 变化 |
|---|---|---|---|
| 任务完成率 | 100% (10/10) | 100% (10/10) | 不下降 |
| 平均总 token | 14702 | 14351 | -2.4% |
| 平均 prompt tokens | 11546 | 11509 | -0.3% |
| prompt 峰值 | 66144 | 63106 | -4.6% |
| 平均步骤数 | 13.0 | 11.8 | -9.2% |

| 实验(编码任务组) | 基线 | 开启插件 | 变化 |
|---|---|---|---|
| 任务完成率 | 90% (9/10) | 90% (9/10) | 不下降 |
| 平均总 token | 8225 | 9114 | +10.8%(波动) |

> 原始输出:`eval/results/*.jsonl`。说明:headless profile 工具总数较少,工具裁剪的 token 节省幅度有限;编码任务不含只读画像关键词,裁剪不触发,+10.8% 为模型行为波动。
