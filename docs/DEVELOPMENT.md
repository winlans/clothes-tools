# PDF 服装版图可视化排版工具：开发说明

## 1. 文档状态

- 状态：已确认方案，正在按任务实施
- 发布平台：Linux x86_64、Windows x64
- 桌面技术：Tauri 2 + Vue 3 + TypeScript
- 画板技术：Konva（通过 Vue 组件封装）
- PDF 引擎：MuPDF WASM
- 许可证：AGPL-3.0-or-later
- 最终输出：保持 1:1 尺寸的单根节点矢量 SVG

Vue 可以完整替代原方案中的 React。共享转换核心、CLI、工程文件和 SVG
导出算法都是框架无关的 TypeScript；只有桌面应用的组件层改为 Vue。

## 2. 产品目标

将分块打印的多页服装版图 PDF 转换为一个可视化排版工程。用户不需要手写
页码表达式即可完成排版，并能继续使用命令行批处理。

标准流程：

1. 用户导入一个 PDF。
2. MuPDF WASM 解析页数、页面尺寸和页面矢量内容。
3. 每页生成预览图片；图片仅用于画板显示，不写入最终 SVG。
4. 应用根据逐页辅助线模式自动识别每列页数并按列优先排列；识别不可靠时使用默认值
   3，用户仍可直接修改。
5. 用户通过拖拽、空白占位和自动吸附修正排版。
6. 用户直接导出 SVG。
7. 导出过程重新使用 PDF 的矢量内容、接缝裁切和页面布局生成成品。

## 3. 用户故事

- **US-01 导入 PDF**：用户可从系统文件对话框选择 PDF，并看到加载进度与
  明确错误。
- **US-02 页面预览**：PDF 的每一页显示为带页码的清晰预览图。
- **US-03 自动排列**：应用从逐页辅助线模式推断每列页数，页面按先向下、再向右排列；
  用户可以覆盖识别结果。
- **US-04 手动排版**：用户可把页面拖到目标格，松手后自动吸附。
- **US-05 插入重排**：拖到已有页面时执行稳定插入，后续页面依次后移，
  原位置自动补齐。
- **US-06 空白占位**：用户可插入、移动和删除明确的空白块，以表达不等长
  列或中间缺页。
- **US-07 浏览画板**：用户可缩放、平移、适合内容，但不能意外改变成品比例。
- **US-08 接缝调整**：应用自动检测拼接线，用户可直接微调坐标并决定是否应用
  页间接缝裁切。
- **US-09 简单转换**：桌面端不要求工程文件，导入和微调后可直接导出。
- **US-10 矢量导出**：导出 SVG 保持原 PDF 尺寸与矢量对象，且适合导入
  CorelDRAW。
- **US-11 CLI 批处理**：已有 `-i/-o/-c/-p` 调用方式在新 CLI 中继续工作。
- **US-12 可诊断失败**：缺页、重复页、尺寸不一致、接缝检测失败和覆盖输出
  均提供可操作的中文错误。
- **US-13 区域消除**：用户可在参考页用画笔选择页码、水印等完整矢量对象，查看
  自动高亮结果，以加选/减选修正，并选择仅参考页或全部页面后写入工程与导出。

## 4. 范围边界

第一版包含：

- 一次编辑一个 PDF；
- 所有分块页尺寸一致；
- 列优先矩形网格与空白占位；
- 视图缩放，不改变页面输出比例；
- SVG 导出和 CLI；
- Linux AppImage/deb、Windows NSIS/MSI 和两平台 CLI 发布包。

第一版不包含：

- 多 PDF 混排；
- 页面旋转或独立缩放；
- 任意坐标的自由排版导出；
- CDR、PLT 或 DXF 直接导出；
- 云端上传、账号或多人协作。

## 5. 系统架构

项目采用 pnpm workspace：

```text
apps/
  desktop/                 Tauri 2 + Vue 3 桌面应用
packages/
  core/                    浏览器与 CLI 共享的 TypeScript 核心
  cli/                     pdf-pattern-svg 命令行程序
```

### 5.1 `packages/core`

核心不得依赖 Vue、Tauri 或 Node 专属文件 API。环境差异通过适配器注入：

- `PdfEngine`：MuPDF 文档打开、页 SVG、页像素和页面尺寸；
- `FileAdapter`：读取、写入和路径解析；
- `ProgressSink`：长任务进度与取消；
- `Clock`：测试中生成稳定时间值。

主要公开能力：

```ts
openDocument(bytes: Uint8Array): Promise<PdfDocumentInfo>
renderPreview(documentId: string, pageNumber: number, options: PreviewOptions): Promise<PreviewImage>
detectGuides(documentId: string, options: GuideDetectionOptions): Promise<DetectedGuides>
createAutomaticLayout(pageCount: number, pagesPerColumn: number): LayoutGrid
parsePageLayout(expression: string, pageCount: number, allowUnused?: boolean): LayoutGrid
exportSvg(documentId: string, project: ExportProject): Promise<ExportResult>
```

### 5.2 `apps/desktop`

- Vue 3 Composition API + `<script setup lang="ts">`；
- Tailwind CSS v4 + shadcn-vue（`reka-mira`）提供标准控件、弹层和设计令牌；
- Pinia 保存当前文档、布局、选择和历史记录；
- Konva 负责画板渲染、拖拽、命中检测、缩放和平移；
- MuPDF 放入专用 Web Worker，避免 PDF 解析和 SVG 导出阻塞界面；
- Tauri dialog/fs/persisted-scope 插件处理文件选择、写入和工程重开；
- Rust 代码初始化 Tauri 与插件，并为工程中记录的单个 PDF 路径授予最小读取
  权限；排版、解析与导出业务逻辑仍全部位于共享 TypeScript 核心。

#### 5.2.1 界面组件约定

- shadcn-vue 组件源码位于 `apps/desktop/src/components/ui`，配置保存在
  `apps/desktop/components.json`；图标统一使用 Lucide；
- 主题变量与现有画板布局样式集中在 `apps/desktop/src/styles.css`。桌面端固定使用
  紧凑深色主题，主操作使用蓝色，组件业务代码不得重新定义一套按钮或表单视觉；
- 新增标准控件时，从 `apps/desktop` 目录运行
  `pnpm dlx shadcn-vue@latest add <component>`，再通过 `@/components/ui` 引用；
- 图标按钮使用 `IconButton.vue`，同时提供可访问名称、原生 `title` 和
  shadcn Tooltip；
- PDF 文件选择器与系统颜色选择器保留原生控件，Konva 画板继续使用自身事件和
  渲染模型，这些不应包装成 shadcn 表单组件；
- 官方生成的 Reka 属性转发类型与仓库根级 `exactOptionalPropertyTypes` 不完全兼容，
  因此仅桌面应用的 `tsconfig.json` 关闭该选项；共享 Core 与 CLI 继续保持根级严格设置。

### 5.3 `packages/cli`

- 调用与桌面应用相同的 `packages/core`；
- 运行时使用 MuPDF WASM，不调用 Python、Poppler 或 librsvg；
- Linux 和 Windows 发布包包含内嵌 MuPDF WASM 的单文件 `pdf-pattern-svg`
  可执行程序；
- CLI 与桌面应用对同一工程必须得到相同 SVG。

## 6. 领域模型

### 6.1 布局

```ts
type PageCell = { kind: "page"; pageNumber: number };
type SpacerCell = { kind: "spacer" };
type LayoutCell = PageCell | SpacerCell | null;

interface LayoutGrid {
  rows: number;
  columns: number;
  traversal: "column-major";
  cells: LayoutCell[][]; // [row][column]
}
```

约束：

- 页码从 1 开始；
- 默认每一页恰好出现一次；
- `SpacerCell` 是需要保存和导出的明确空位；
- `null` 只表示未使用格，不是业务占位；
- 插入溢出时在最右侧增加一列；
- 导出到 `-p` 表达式时，`SpacerCell` 与必要的矩形补位都编码为 `-`。

### 6.2 拖拽规则

- 拖到空格：页面进入该位置；原页面从序列中移除并自动补齐；
- 拖到占用格：先从列优先序列移除拖动项，再插入目标位置，目标及后续项
  向后移动；
- 从工具栏拖入空白块：在目标位置插入 `SpacerCell` 并向后挤占；
- 拖动已有空白块：与页面采用相同稳定移动算法；
- 页面或空白块不得停在格子之间；
- 撤销/重做记录每次完整的布局变更，默认保存最近 100 次。

### 6.3 接缝和裁切

```ts
interface GuideSettings {
  mode: "auto" | "manual" | "none";
  seamLeft?: number;
  seamRight?: number;
  seamTop?: number;
  seamBottom?: number;
  outerLeft: number;
  outerRight?: number;
  outerTop: number;
  outerBottom?: number;
  detection: {
    dpi: number;
    redMin: number;
    otherMax: number;
    redDelta: number;
    minimumFraction: number;
  };
}
```

默认值与当前 Python CLI 保持一致。坐标单位始终为 PDF point，
`72 pt = 1 inch`。桌面端不把三个内部取值呈现为互斥模式：`auto` 表示检测值，
任一坐标经用户修改后保存为 `manual`，关闭页间接缝裁切时保存为 `none`。工程
文件和 CLI 继续接受三个取值，保持向后兼容。

## 7. PDF 处理与矢量导出

### 7.1 文档打开

1. 将 PDF 作为 `Uint8Array` 传给 MuPDF WASM。
2. 读取页数、每页边界与旋转后的显示尺寸。
3. 校验所有页面尺寸，允许最大 `0.02pt` 浮点误差。
4. 计算源文件 SHA-256，作为工程重新关联校验值。

### 7.2 预览

- 首屏优先渲染可见页和左侧缩略图；
- 默认预览长边约 1600px；
- 预览以 PNG/Object URL 形式进入 Konva；
- 打开文档和更新辅助线清理坐标时递增预览代际；Worker 返回的栅格、SVG、局部预览
  与进度均带代际编号，Store 丢弃旧代际结果，避免首次识别时未清线预览覆盖新结果；
- 缩放超过当前预览清晰度时，只重绘可见页；
- 离开文档时释放 Object URL、Pixmap 与 MuPDF 文档对象。

### 7.3 辅助线模式检测

颜色不再是辅助线方案能否工作的唯一依据：

1. 低 DPI 渲染每页像素，先保留原有红色阈值检测作为兼容快速路径；
2. 完全没有红色候选线时，对可见墨迹统计横向、纵向投影；
3. 只保留靠近页面四边、跨页坐标重复的长线候选，不依赖红、蓝或其他色相；
4. 跨页面聚类时优先选择支持页面数最多的一组，避免少数页面的普通长线干扰；
5. 候选必须能够按页面顺序解释为完整的列切换和列末页，才作为自动识别结果；
6. 按页面顺序使用左右线识别列切换，使用“有上线、无下线”识别各列末页；
7. 短列根据列首辅助线相对首列的差异对齐，并自动插入空白占位；
8. 无法检测时允许用户直接填写对应接缝，或关闭页间接缝裁切。

### 7.3.1 无辅助线内容匹配

- 拼接策略支持自动识别、强制辅助线拼接和强制内容匹配；内部继续使用
  `red-guides` 兼容旧工程，未保存策略的旧工程按自动
  识别处理；
- 自动识别依次运行颜色辅助线、跨页辅助线模式和内容匹配；颜色路径检测到任意
  辅助线时保持原行为，模式路径只有形成可靠布局时才阻止内容匹配兜底；
- 强制模式只运行用户指定的检测阶段，并随工程持久化；
- 内容匹配在当前 DPI 未形成可靠布局时，依次尝试 120、48 DPI，成功后停止；重试
  不改变工程保存的红线检测参数，并在结果元数据中记录实际栅格 DPI；
- 页面页序仍按列优先解释，通过全局候选布局处理短列顶部空白；
- 高置信度结果转换为现有绝对拼接坐标后复用预览和导出链路；
- 内容匹配文档的界面显示四边裁切量，旧工程和辅助线文档继续显示绝对坐标；
- 内容匹配裁切量支持可选的四方向同步编辑；
- 输入模式仅在内容匹配工程中以可选字段保存，缺失时始终采用旧模式。

### 7.4 SVG 输出

1. 使用 MuPDF `DocumentWriter(..., "svg")` 获取各页矢量 SVG；
2. 解析页面 SVG，先兼容移除红色辅助线，再按已检测坐标移除其他颜色的线型元素，
   同时支持移除可选的白色背景；
3. 为每个页面实例重写 ID 及 `url(#id)`、`href` 引用；
4. 根据所在行列选择外边界或接缝裁切；
5. 用一个根 `<svg>`、`<defs>`、`<clipPath>` 和 `<g transform>` 合并页面；
6. 写入毫米尺寸和 point 坐标 `viewBox`；
7. 校验根节点数量、可见对象数量和输出尺寸。

预览 PNG 永远不作为整页图片写入最终 SVG。源 PDF 中原本存在的图片对象可以
继续作为图片存在。

### 7.4.1 画笔矢量对象消除

- 画板把屏幕坐标反算为未裁切 PDF 的页面本地 point 坐标，并把连续拖动保存为
  带半径的 `add` 或 `subtract` 笔画；旋转、缩放和接缝裁切不改变规则坐标；
- MuPDF 设备包装器在 `fillPath`、`strokePath`、文字绘制和渐变绘制调用处进行命中，
  笔画接触对象即选中整个绘制操作；图片不参与选择，接近整页的填充背景也会忽略；
- 一条规则先在参考页识别对象并返回红色 SVG 覆盖层。跨页应用时只匹配参考页已
  命中的对象类型，防止同一坐标偶然经过的其他纸样路径被删除；
- `add` 命中集合减去 `subtract` 命中集合得到最终对象集合。范围为 `all-pages` 时
  每页使用相同页面本地笔画，为 `current-page` 时仅应用参考页；
- 已确认规则由预览、局部放大、SVG 页渲染和 PLT 的 SVG 前置阶段共用。辅助线检测
  始终读取未过滤原页，因此画笔规则不会改变既有辅助线或内容匹配方案；
- Worker 为跨页高亮返回逐页进度并支持取消，Store 使用独立请求编号忽略过期结果。

### 7.5 CorelDRAW PLT 输出

桌面端先生成与 SVG 导出完全相同的组合 SVG，再由共享 Core 转换器生成基础
HP-GL：

1. 解析组合 SVG，展开 `defs/use`、继承样式、变换和裁切路径；
2. 把文字字形轮廓、填充边界和描边中心线转换为刀路，展开虚线；
3. 以默认 0.05 mm 物理误差自适应离散贝塞尔曲线；
4. 按 `1016 units/inch` 量化坐标，并把 SVG 左上角原点翻转为 HP-GL 左下角原点；
5. 输出 ASCII、无 BOM 的 `IN; SP1; PA; PU/PD; ... SP0;` 命令流；
6. 跳过位图并返回用户可见警告，保留路径数和线段数作为导出摘要。

该 PLT 以 CorelDRAW 2021–2024 导入为兼容目标，不承诺直接驱动具体绘图仪。
CLI 保持现有 SVG 行为，不增加 PLT 参数。

## 8. 桌面交互

### 8.1 界面区域

- 顶部工具栏：当前 PDF 信息、自动排列、适合内容、导出与更换 PDF；
- 布局命令栏：从工具按钮拖入空白块、撤销、重做以及增加或删除行列；
- 中部：无限背景画板、排版网格、页面预览和吸附目标；
- 右侧：接缝裁切开关、检测值微调、外边界、导出设置和成品尺寸；
- 底部状态栏：缩放比例、页面使用情况、任务进度和错误摘要。

### 8.2 画板导航

- 鼠标滚轮以光标位置为中心缩放；
- 缩放范围 10%–400%；
- 空格键 + 左键或鼠标中键平移；
- “适合内容”将整个有效网格放入可视区域；
- 所有缩放仅改变摄像机，不改变 PDF point 尺寸。

### 8.3 导入与导出

- 导入后先以每列 3 页显示，辅助线模式检测确认列边界后自动更新每列页数；
- 图片拼接检测运行期间，普通与全屏画布显示当前检测阶段和逐页进度遮罩，完成或
  失败后自动移除；
- 用户可接受自动布局或修改数值；一旦修改布局，迟到的检测结果不再覆盖；
- 导出前显示页数使用情况、成品毫米尺寸、接缝来源和输出路径；
- 默认阻止存在未使用页面的导出；高级选项可显式允许；
- 导出运行在 Worker 中，展示按页面计算的进度并允许取消。

## 9. 工程文件

扩展名：`.pattern-layout.json`。

```json
{
  "schemaVersion": 1,
  "source": {
    "absolutePath": "/path/to/input.pdf",
    "relativePath": "./input.pdf",
    "sha256": "...",
    "pageCount": 15,
    "pageSizePt": { "width": 841.89, "height": 1190.551 }
  },
  "layout": {
    "rows": 3,
    "columns": 5,
    "traversal": "column-major",
    "cells": []
  },
  "guides": {},
  "output": {
    "keepGuides": false,
    "keepBackground": false,
    "allowUnusedPages": false,
    "objectExclusions": [
      {
        "id": "watermark-1",
        "sourcePageNumber": 1,
        "scope": "all-pages",
        "objectKinds": ["text"],
        "strokes": [
          {
            "operation": "add",
            "radiusPt": 8,
            "points": [{ "x": 300, "y": 420 }]
          }
        ]
      }
    ]
  },
  "view": {
    "zoom": 1,
    "panX": 0,
    "panY": 0
  }
}
```

打开工程时按以下顺序查找 PDF：相对路径、绝对路径、用户重新选择。重新选择
后必须校验页数、页面尺寸和 SHA-256；不一致时展示差异并要求用户确认是否创建
一个新工程，不能静默替换源文件。

## 10. CLI 兼容

新入口：

```bash
pdf-pattern-svg -i input.pdf -c 3
pdf-pattern-svg -i input.pdf -p '1-3|4-5|6-9'
pdf-pattern-svg --project layout.pattern-layout.json -o output.svg
```

兼容要求：

- `-i/--input`、`-o/--output`、`-c/--pages-per-column`；
- `-p/--page-layout/--layout`，包括正序范围、倒序范围与空白标记；
- `--columns`、`--order`、行列重排、接缝和外边界参数；
- 红线检测阈值、保留辅助线/背景、检测模式、工作目录和覆盖保护；
- 未指定 `-o` 时仍生成输入 PDF 同名 `.svg`；
- 用户输入错误退出码为 2，错误信息使用中文；
- `--rsvg-convert` 与 `--no-flatten` 保留解析但给出弃用提示，新核心始终输出
  单根节点 SVG。

## 11. 非功能要求

- 15 页 A3 PDF 首批缩略图在当前目标机器上 3 秒内出现；
- 完整预览和 SVG 导出分别不超过 15 秒；
- 长任务不阻塞拖拽、缩放或窗口响应；
- 预览缓存应可淘汰，常规 15 页文档内存目标低于 500MB；
- 对不受信任 PDF 的处理全部限制在 MuPDF WASM Worker；
- Tauri 文件权限仅开放给用户通过对话框选择的文件，或用户已选择工程中记录的
  单个 `.pdf` 路径；工程源文件仍必须通过尺寸与 SHA-256 校验；
- 发布包包含 AGPL、MuPDF 版权声明和完整对应源码获取方式。

## 12. 测试与验收

### 核心单元测试

- 自动与手动布局、`1-5`/`5-1` 范围、空白和错误页码；
- 插入、移动、稳定挤占、自动扩列和撤销/重做；
- 红色像素筛选、位置聚类和接缝失败；
- 工程 schema 校验、路径重关联和版本迁移；
- SVG ID 重写、裁切、尺寸与单根节点校验。

### 真实 PDF 回归

- `ku小红叶528-4XL-A3.pdf`：15 页、5 列 × 3 行；
- `小红叶639-1合身T-4XL-A3.pdf`：8 页、2 列 × 4 行和外边界覆盖；
- 新旧输出尺寸误差不超过 `0.1pt`；
- 144 DPI 比较时，主体线条覆盖率至少 99%，允许抗锯齿边缘 1px 差异；
- 矢量源不得退化为整页位图；输出只能有一个 SVG 根节点。

### 桌面端测试

- Vue 组件和 Pinia store 使用 Vitest；
- 拖拽、吸附、空白插入、缩放、工程保存和导出使用浏览器级自动化；
- Linux 上执行 Tauri 启动、文件对话框、AppImage 和 deb 安装冒烟测试。
- Windows CI 原生生成 NSIS 和 MSI；Windows 10/11 实机完成安装与 SVG 导出验收。

## 13. 交付顺序

采用可独立验收的纵向切片，不按“先写完核心、再写完 UI”的水平层次组织。
每个开发任务都必须包含其所需的核心、界面或 CLI 接口以及对应测试。任务清单
在确认 issue tracker 和粒度后发布。
