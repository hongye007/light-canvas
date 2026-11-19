# MaxFlow 无限画布 · 整体设计规格（v1）

> 阶段定位：一期 = 可嵌入任意网页的无限画布库。功能要对标 infinite-canvas / libtv 的厚度，节点体系必须支持未来 3D 导演台这类重交互扩展。
> 本文件只定架构与接口，不含实现代码。确认后按第 12 节的里程碑推进。

---

## 1. 目标与硬约束

### 1.1 一期目标（必须达到）

| # | 目标 | 验收方式 |
|---|---|---|
| G1 | **可嵌入**：`npm i` 后一行组件挂进任意 React 应用 | demo 应用 + 一个真实宿主页面 |
| G2 | **功能厚度对标**：视口、节点、连线、分组、选择、快捷键、撤销、导入导出、小地图、批量生成 | 逐条对照第 4 节清单 |
| G3 | **节点可扩展**：第三方节点类型不用改画布源码即可注册 | 用插件节点做一个「3D 预览占位」验证 |
| G4 | **主题**：黑白双色 + 配色可配（品牌色、强调色、背景） | 换一份 token 文件，画布整体换肤 |
| G5 | **语言**：中文 / 英文，宿主可注入字典 | 运行时切换，不刷新 |
| G6 | **AI 能力可配置**：文生图、图生图、文生视频、视频编辑全部走 Producer 接口 | 一期 mock 即可跑通全链路 |

### 1.2 硬约束（违反即架构失败）

1. **画布内核不直接发网络请求、不 import 任何业务代码。** 一切外部需求经 `HostBridge` / `Producer`。
2. **宿主不需要改画布源码就能接入。** 若某次接入要改画布，说明契约漏了一项，补契约而非加分支。
3. **差异通过「注册 / 开关 / 注入」表达**，代码里不出现 `if (host === '项目A')`。
4. **文档是纯 JSON、带版本号、可迁移。** 不得把 React 状态形状直接序列化。
5. **一次手势 = 一个撤销单元。**

---

## 2. 分层架构

```
┌──────────────────────────────────────────────────────────┐
│ 宿主应用（若干）                                          │
│  React 页面 / 独立站点 / 未来 iframe 壳                  │
└───────────────┬──────────────────────────────────────────┘
                │  props: config / bridge / theme / i18n
┌───────────────▼──────────────────────────────────────────┐
│ @maxflow/canvas-react     视图层                          │
│  画布容器 · 节点壳 · 连线 · Composer · 小地图 · 工具栏   │
│  只依赖 core 的接口与 react                               │
└───────────────┬──────────────────────────────────────────┘
                │  真实 import
┌───────────────▼──────────────────────────────────────────┐
│ @maxflow/canvas-core      内核层（纯 TS，零 React 零 DOM） │
│  文档模型 · 命令层 · 几何 · 历史栈 · 序列化与迁移          │
│  节点注册表 · 执行图 · 选择与视口的纯计算                  │
└───────────────▲──────────────────────────────────────────┘
                │  接口实现注入
┌───────────────┴──────────────────────────────────────────┐
│ @maxflow/canvas-ai        AI 适配层                       │
│  Producer 接口 · task 模型 · http/mock 实现 · 轮询与取消   │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│ @maxflow/host-sdk         宿主契约                        │
│  HostBridge 类型 · mockHost · 一致性测试套件 · 默认实现    │
└──────────────────────────────────────────────────────────┘
```

**依赖方向只能向下。** core 不知道 React 存在，react 不知道 http 存在，ai 不知道宿主存在。

### 2.1 为什么内核必须零 React

未来 3D 导演台、可能的 WebGL 渲染器、协作/服务端重放，都要求「文档 + 命令」能在没有 React 的环境跑。infinite-canvas 把撤销栈、选择、拖拽全塞在 3400 行的页面里，这是它接不进第二个项目的根因。我们第一天就切断。

---

## 3. 文档模型

### 3.1 结构

```ts
CanvasDocument {
  version: number            // schema 版本，迁移用
  id: string
  title: string
  createdAt / updatedAt: ISO
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: { x, y, k }      // 每个画布记住自己的视口
  background: "dots" | "lines" | "blank"
  meta: Record<string, unknown>   // 宿主自定义字段，画布不解释
}

CanvasNode {
  id: string
  type: string               // "text" | "image" | "video" | "group" | "插件ID:名称"
  version: number            // 节点数据版本，独立迁移
  title: string
  position: { x, y }         // 世界坐标
  width / height: number
  data: unknown              // 由节点定义决定，见第 5 节
  groupId?: string
  z: number                  // 绘制顺序
}

CanvasEdge {
  id: string
  from: { nodeId, port }     // 输出锚点
  to:   { nodeId, port }     // 输入锚点
  kind: "reference" | "data" // 一期固定 reference
}
```

### 3.2 三个刻意的设计

- **`meta` 字段**：宿主想往文档里塞自己的东西（外部资源 ID、审计信息）不用改画布。画布只保证读写时原样保留。
- **`edg` 带端口**：一期每个节点只有 `out` / `in` 两个锚点，但结构上允许未来多端口（3D 导演台可能同时接多路素材）。
- **`z` 显式存在**：不靠数组顺序，避免协作合并时顺序漂移。

### 3.3 迁移

- `migrate(doc): CanvasDocument` 是纯函数链：`v1 → v2 → v3`。
- 读文档永远先迁移再校验；写文档永远写最新版本。
- **兼容策略：至少兼容上一个 major 版本的文档**，更老的版本给出明确错误而不是静默丢弃。
- 节点数据迁移由节点定义自己提供（`nodeDefinition.migrate`），画布只调度。

---

## 4. 功能清单（一期 vs 二期）

### 4.1 画布引擎（一期全做）

| 能力 | 细节 |
|---|---|
| 视口 | 滚轮以光标为锚缩放（0.05–5×）、空格/中键拖拽平移、按住 Ctrl 临时切换、fit-to-content、缩放百分比控件 |
| 背景 | 点阵 / 网格 / 空白，随视口偏移；颜色走 token |
| 节点 | 拖拽、八向缩放、多选整体拖拽、对齐参考线吸附、z 顺序调整 |
| 选择 | 点选、框选、Shift 加选、全选、点击空白取消 |
| 连线 | 贝塞尔曲线、16px 命中热区、拖拽建连、连线中段「插入节点」菜单、删除连线 |
| 分组 | 成组/解组、拖入组吸附、组内节点随组移动、折叠 |
| 编辑 | 双击进入节点内编辑、Esc 退出、文本节点内联编辑 |
| 历史 | 撤销/重做、手势合并、栈深度限制、可配置 |
| 剪贴板 | 复制/剪切/粘贴（含连线关系重建）、跨画布粘贴 |
| 快捷键 | 见 4.2 |
| 导航 | 小地图（点击跳转、拖拽、视口框）、Ctrl+K 节点搜索跳转 |
| 持久化 | 自动保存（防抖）、导入/导出 JSON、导出 PNG（可选二期） |
| 性能 | 视口剔除、单 transform 容器、拖拽 rAF 节流、连线超过阈值切 canvas 渲染 |

### 4.2 快捷键

| 键 | 动作 |
|---|---|
| 空格 + 拖 / 中键拖 | 平移 |
| Ctrl/⌘ + 滚轮 | 缩放（滚轮默认也是缩放） |
| Ctrl/⌘ + Z / Shift+Z | 撤销 / 重做 |
| Ctrl/⌘ + C / X / V | 复制 / 剪切 / 粘贴 |
| Ctrl/⌘ + A | 全选 |
| Delete / Backspace | 删除 |
| Ctrl/⌘ + G / Shift+G | 成组 / 解组 |
| Ctrl/⌘ + 0 | fit to content |
| Ctrl/⌘ + +/- | 缩放 |
| Ctrl/⌘ + K | 搜索节点 |
| Esc | 取消选择 / 退出编辑 |
| Enter（选中文本节点） | 进入编辑 |

### 4.3 AI 能力（一期接通接口，二期接真后端）

| 能力 | 一期 | 说明 |
|---|---|---|
| 文生图 | ✅ 接口 + mock | 参数：比例、画质、清晰度、背景、数量 1/2/4 |
| 图生图 / 图片编辑 | ✅ 接口 + mock | 上游连线自动作为参考 |
| 文生视频 | ✅ 接口 + mock | 参数：时长、比例、清晰度 |
| 视频编辑 | ✅ 接口 + mock | 片段截取 / 重拍 / 分离音视频先做入口占位 |
| 提示词反推 | ✅ 接口 | 图片节点 → 生成文本节点并连线 |
| 高清 / 扩图 / 抠图 | 二期 | 入口在选中工具条里预留位 |
| 音频、导演台、智能剪辑 | 二期 | 插件节点形式 |
| 画布 Agent | 二期 | 需要后端与工具调用 |

### 4.4 明确不做（一期）

- 多人实时协作（但命令层已为协作预留）
- 服务端任务队列（那是后端的事）
- 云资产库、账号体系、计费（交给宿主）

---

## 5. 节点扩展体系（核心设计）

### 5.1 契约

```ts
type NodeDefinition<TData = unknown> = {
  type: string                        // 唯一键，插件用 "pluginId:name"
  version: number                     // 数据版本，独立迁移
  label: (t: Translate) => string     // 菜单文案，走 i18n
  icon: IconComponent

  // 几何
  defaultSize: { width, height }
  minSize?: { width, height }
  resizable: boolean
  aspectLocked: boolean               // 视频节点锁比例

  // 能力声明（驱动 UI，不驱动 if）
  capabilities: {
    canGenerate: boolean              // 有生成参数，Composer 会显示
    generateKind?: "image" | "video" | "text"
    acceptsReference: boolean         // 能接收上游参考
    providesReference: boolean        // 能作为上游被引用
    canConnect: boolean               // 允许连线（分组节点不允许）
    canBeGrouped: boolean
  }

  // 渲染
  render: (ctx: NodeRenderContext<TData>) => ReactNode
  renderEmpty?: (ctx) => ReactNode    // 空态（截图里的「尝试：」列表）
  renderHoverToolbar?: (ctx) => ReactNode
  minimapColor?: (theme) => string

  // 数据
  createData: (seed?: unknown) => TData
  migrateData?: (data: unknown, fromVersion: number) => TData
  serialize?: (data: TData) => unknown
  onDoubleClick?: (ctx) => void

  // 生成（可选）
  buildTask?: (ctx: NodeGenerateContext<TData>) => GenerationTask | null
  onResult?: (ctx, result: GenerationResult) => TData
}
```

**判定标准**：3D 导演台能不能只靠这个契约实现？答案是可以——它声明 `resizable: true`、`capabilities.canGenerate: false`、自带 `render` 里挂 WebGL canvas、用 `onDoubleClick` 进全屏编辑、需要多路输入时扩展 `ports`。画布侧不需要为它加任何代码。

### 5.2 注册表

- 全局 `NodeRegistry`，`register(def)` / 查表 / 列出可用节点。
- **按 profile 过滤**：生成编排模式只注册 text/image/video，菜单里就不会出现别的。
- 插件节点独立发包：`@maxflow/node-audio`、`@maxflow/node-director`，宿主装了才有。
- 未注册类型读到文档时，渲染成「未知节点」占位（保留数据，不丢），而不是报错。

### 5.3 插件上下文

插件节点通过 `NodeRenderContext` 拿到：节点数据、更新函数、选择态、视口缩放、主题 token、i18n、执行状态、以及一个受控的 `requestAction`（比如请求生成、请求连线）。**插件永远拿不到整个 store**，避免插件污染内核。

---

## 6. 执行图与连线语义

### 6.1 语义

连线 = **上游为下游提供参考/输入**。方向永远从「生产者」指向「消费者」。

图片/视频节点被触发时：
1. 遍历所有入边，收集上游节点的当前资产与文本；
2. 组装成 `references` 数组；
3. 交给 Producer；
4. 结果写回本节点，并发事件。

### 6.2 为什么不自建执行引擎

infinite-canvas 和 libtv 本质都是「单节点触发式生成」，没有 DAG 调度。一期跟随这个心智模型（简单、用户可预期）。但 `CanvasEdge` 的结构和 `references` 的组装函数放在 core 里，二期若要做「全图一键执行」，只是在同一份数据上加一个拓扑遍历，不动文档结构。

### 6.3 防环

建连时检测环，拒绝建立会让图成环的边。

---

## 7. 接口契约

### 7.1 Producer（AI 能力）

```ts
Producer {
  submit(task: GenerationTask): Promise<{ taskId: string }>
  subscribe(taskId, cb: (event: TaskEvent) => void): () => void
  cancel(taskId): Promise<void>
  resolveAsset?(assetId): Promise<string>   // 资产 id → 可访问 URL
}

GenerationTask {
  kind: "text-to-image" | "image-edit" | "text-to-video" | "video-edit" | "describe-image"
  model: string
  prompt: string
  references: Reference[]        // { nodeId, assetId?, kind, text? }
  params: { ratio, quality, resolution, background, count, durationSec }
  hostContext: unknown           // 宿主自定义透传（tenant、traceId 等）
}

TaskEvent =
  | { type: "progress", value: number }
  | { type: "partial", assets: Asset[] }     // 批量出图逐张返回
  | { type: "done", assets: Asset[], cost?: number }
  | { type: "error", message: string, retryable: boolean }
```

**为什么统一成 task 而不是每个能力一个 Promise**：视频动辄几十秒，批量出图要逐张返回，取消和重试都要一致。统一后节点只有一套状态机（idle / queued / running / success / error），进度、取消、重试全复用。

一期提供三个实现：`mockProducer`（本地占位图 + 假进度）、`httpProducer`（可配 endpoint 与字段映射）、`openAICompatibleProducer`（直连用户 API Key）。

### 7.2 HostBridge（宿主环境）

| 方法 | 必需 | 默认实现 | 说明 |
|---|---|---|---|
| `getAuthHeaders()` | 否 | `{}` | 嵌入时宿主注入 token |
| `listModels()` | 否 | 内置清单 | 模型与能力声明 |
| `checkQuota(task)` | 否 | 永远通过 | 返回额度不足则阻止提交 |
| `upload(file)` | 否 | 转 objectURL | 图片/视频上传 |
| `resolveAssetUrl(id)` | 否 | 原样返回 | 资产 URL 解析 |
| `loadDocument(id)` | 否 | 本地存储 | 文档读写交给宿主 |
| `saveDocument(id, doc)` | 否 | 本地存储 | 同上 |
| `track(event, payload)` | 否 | 空操作 | 埋点 |
| `openExternal(target)` | 否 | `window.open` | 跳到宿主的资产库等 |
| `confirm(message)` | 否 | `window.confirm` | 危险操作确认 |

**每条都有默认实现**，新接入最少只实现 2 个方法就能跑。

### 7.3 嵌入方式

**首选：库嵌入**

```tsx
<MaxFlowCanvas
  profile="full"
  documentId="project-123"
  bridge={bridge}
  producer={producer}
  theme={{ mode: "dark", tokens: { accent: "#2b6de8" } }}
  locale={{ lang: "zh-CN", messages: {...} }}
  onChange={(doc) => save(doc)}
  onRequestAssetPicker={() => host.openPicker()}
/>
```

**预留：iframe 壳**

只要 `HostBridge` 与 `Producer` 的入参与返回值都是可序列化的 JSON，同一个协议就能通过 `postMessage` 转发。将来非 React 项目接入时，包一层 iframe 壳，画布代码零改动。这是把嵌入方式选成「库」时唯一需要提前守住的纪律。

---

## 8. 主题与配色

### 8.1 三层 token

```
基础层（不随品牌变）：间距、圆角、字号、动效时长、层级
语义层（可映射）：surface / surface-raised / border / text-primary /
                  text-secondary / accent / accent-soft / danger / success
品牌层（宿主注入）：accent、logo、产品名
```

组件**只消费语义层**，不写死颜色。宿主要换肤，只改语义层映射。

### 8.2 黑白双色

- `mode: "light" | "dark" | "system"`，默认跟随系统。
- 深色模式对齐截图：近黑底（#111 系）、低对比边框、点阵背景、卡片微亮。
- 浅色模式同一套 token 的另一组值，不是简单反色。

### 8.3 配色可配

宿主可传 `theme.tokens` 覆盖任意语义 token，未传的走默认。所有 token 输出为 CSS 变量并挂在画布根节点上，**不污染宿主全局样式**（也便于未来 iframe 化）。

### 8.4 样式隔离

- Tailwind 预编译 + 前缀，或 CSS Modules；不依赖宿主是否装了 Tailwind。
- 所有选择器限定在画布根类名下。
- 预留 Shadow DOM 挂载模式（`mountMode="shadow"`）作为二期兜底。

---

## 9. 国际化

- 运行时切换，不刷新页面。
- 内置 `zh-CN` / `en-US` 两份完整字典；缺词回退到 `en-US` 并在开发环境告警。
- 宿主可传部分字典覆盖或补充。
- **节点定义自带文案**：插件节点的标签走同一个 `Translate` 函数，插件自带字典，画布负责合并。
- 文案 key 命名规范：`node.image.empty.title` 这种层级式，便于对齐。

---

## 10. 性能预算

| 指标 | 目标 | 手段 |
|---|---|---|
| 1000 节点平移 | ≥ 55fps | 视口剔除（只渲染可视区 + 缓冲区）、单 transform 容器 |
| 1000 节点缩放 | ≥ 50fps | 缩放期间降级节点内容（只画占位轮廓），停止后补全 |
| 拖拽单节点 | 60fps | rAF 节流、拖拽期间不改文档、抬手才提交命令 |
| 连线 2000 条 | ≥ 50fps | 超过 500 条切 Canvas 2D 渲染 |
| 冷启动（1000 节点文档） | < 300ms | 文档解析与首批渲染分离 |

---

## 11. 工程结构

```
MaxFlow/
├── packages/
│   ├── canvas-core/
│   │   └── src/{model,commands,geometry,history,registry,migration,serialize}
│   ├── canvas-react/
│   │   └── src/{Canvas,NodeLayer,EdgeLayer,Composer,Toolbar,Minimap,ContextMenu,hooks,i18n,theme}
│   ├── canvas-ai/
│   │   └── src/{producer,http,mock,openai}
│   ├── host-sdk/
│   │   └── src/{bridge,mockHost,conformance}
│   └── nodes/
│       ├── node-text/
│       ├── node-image/
│       └── node-video/
├── apps/
│   └── demo/                # 演示应用：模拟一个宿主
├── docs/                    # 本规格与后续 ADR
└── pnpm-workspace.yaml
```

**为什么拆包**：宿主项目如果只需要画布不要 AI，可以只装 core + react；3D 导演台作为独立包，不影响主包体积。一期可以不发 npm，但按包边界写，二期发布零重构。

---

## 12. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M1 内核** | 文档、命令、几何、历史、序列化、迁移 | 纯函数测试通过，零 DOM 依赖 |
| **M2 画布** | 视口、节点壳、连线、选择、分组、快捷键 | 能拖、能连、能撤销重做、能分组 |
| **M3 契约** | Producer + HostBridge + mock 实现 + 一致性测试 | 无后端跑通「提示词 → 出图」 |
| **M4 节点与外壳** | text / image / video 三节点、Composer、参数面板、工具栏、小地图 | 操作流对齐 libtv 截图 |
| **M5 主题与国际化** | token、深浅色、中英切换 | 切主题与切语言均不回退 |
| **M6 嵌入验收** | demo 应用 + 一个插件节点（3D 占位） | 第三方节点不改画布即可注册 |

---

## 13. 已有决策与待定项

### 已定

- 交付形态：库 + demo，按包边界组织，一期不发布 npm。
- 一期无后端，AI 走 mock；二期接后端只换 Producer。
- 状态层：命令式，一次手势一个撤销单元，为协作预留。
- 嵌入方式：库优先，iframe 作为未来选项（协议保持可序列化）。
- 节点扩展：声明式注册表，插件拿受控上下文。

### 待你确认（不阻塞 M1–M2）

1. **资产存储**：一期图片/视频存 objectURL（刷新失效）还是 IndexedDB（可持久）？推荐 IndexedDB + 宿主可覆盖。
2. **包管理器**：pnpm workspace 可以吗？
3. **是否现在就出 npm 私有包**，还是先 monorepo 内部引用？
4. **品牌默认色**：画布默认强调色用截图里的蓝色系，还是留中性色由宿主注入？
