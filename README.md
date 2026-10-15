# Context Governor — DeepSeek Harness 上下文治理插件

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(dsh)提供的上下文治理插件,解决 Agent 多轮任务中的三个问题:

| 问题 | 能力 | 实现机制 |
|---|---|---|
| 无关工具描述挤占上下文 | **按需工具裁剪** | `agent/pre-step` 时按任务画像调用 `tools.restrict()`,把无关工具移出该 Agent 作用域的可见集 |
| 文件改写/命令执行失控 | **分层权限闸门** | `tools/pre-execute` 瀑布上按"工具名 + 参数路径"计算危险级别,返回 `allow / ask / deny` |
| 冗长工具结果撑爆上下文 | **分层工具结果剪枝** | 提供 `ctx.toolResultPruner` 服务:超预算结果保留头部/尾部/任务目标相关行,中段无关内容以标记压缩 |

## 快速开始

依赖 deepseek-harness 仓库作为开发底座(当前对齐 `dsh-v0.2.0-rc.2`):

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout dsh-v0.2.0-rc.2
pnpm install && pnpm run build

# 加载本插件启动 Web UI(路径按实际位置调整)
pnpm dsh web --patch D:/context-governor/cordis.patch.yml
```

## 配置

所有配置项支持 dsh 运行时热更新(Schemastery 校验):

```yaml
# cordis.patch.yml 片段
- insert:
    - id: context-governor
      name: D:/context-governor/src/index.ts
      config:
        toolFilter:
          enabled: true
          profiles:            # 任务画像,顺序即优先级
            - id: read-only
              keywords: [查看, 检索, 搜索, 阅读, 分析, 理解, 定位, 排查, 总结]
              denyTools: [write_file, edit, apply_patch, bash, shell, terminal, run_code]
          knownTools: []       # 全局工具名清单(deny 模式在此范围内匹配)
        guard:
          enabled: true
          workspaceRoots: [D:/workspace]   # 工作区根;空 = 仅按工具名分级
          readOutside: ask     # 读取工作区外:allow / ask / deny
          write: ask           # 写入文件
          command: ask         # 执行命令
        pruner:
          enabled: true
          threshold: 8000      # 超过该字符数才触发剪枝
          head: 1200           # 头部保留预算(字符)
          tail: 1200           # 尾部保留预算(字符)
          goalKeywords: []     # 任务目标关键词:中段命中这些词的行会被保留
```

## 架构

```
src/
├── index.ts          # ContextGovernor 服务入口,装配三个能力
├── config.ts         # Schemastery 配置 schema 与默认值
├── tool-filter.ts    # dsh 适配:agent/pre-step 工具裁剪
├── guard.ts          # dsh 适配:tools/pre-execute 权限闸门
├── pruner.ts         # dsh 适配:ctx.toolResultPruner 剪枝服务
└── core/             # 纯函数核心逻辑(无 dsh 依赖,可独立单测)
    ├── classify.ts   # 任务画像分类 / glob 工具名匹配
    ├── danger.ts     # 危险度分级 / 路径边界判断 / 闸门决策
    └── prune.ts      # 分层文本剪枝(头尾 + 目标关键词行)
```

核心逻辑与 dsh 适配层分离:分类、分级、剪枝算法全部是纯函数,可用 `node --test` 独立验证与复现。

## 本地测试

```bash
npm install
npm test          # 核心逻辑 11 个单测
npm run typecheck # 对照 deepseek-harness 源码做类型检查
```

## 量化评测

`eval/` 目录包含评测方案:自建编码任务集,对比开/关本插件时的 token 用量、任务完成率与权限拦截情况。任务集位于 `eval/tasks/`,其中 `coding-extra.jsonl` 为扩展编码任务槽位(以一行注释性 JSON 记录字段结构,新增任务按 `coding.jsonl` 的格式追加即可)。

- [eval/README.md](eval/README.md)

> 对照评测结果(20 题任务集,headless profile,DeepSeek 模型):只读任务开启插件后完成率 100%→100%、平均总 token 14702→14351(-2.4%)、平均步骤数 13.0→11.8;编码任务完成率 90%→90%。完整数据见 [eval/README.md](eval/README.md)。

## Roadmap

- [x] 核心逻辑 + 单测(任务分类 / 危险度分级 / 分层剪枝)
- [x] dsh 适配层(工具裁剪 / 权限闸门 / 剪枝服务)
- [ ] 与 compaction-basic 联调,补齐 shadow-price 记账协议
- [ ] 任务画像支持 LLM 分类器(可选,替换关键词规则)
- [ ] 评测脚本与基准数据

## License

MIT
