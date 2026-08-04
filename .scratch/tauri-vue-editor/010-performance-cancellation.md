# 010 性能、取消与资源回收

**类型：AFK**

## What to build

为预览、检测和导出加入任务队列、进度、取消和缓存淘汰。确保大 PDF 操作位于
Worker，文档切换或窗口关闭时释放 MuPDF、Pixmap、Object URL 与 ArrayBuffer，
并对 15 页 A3 基准进行性能记录。

## Acceptance criteria

- [x] 首批可见缩略图在目标机器 3 秒内出现。
- [x] 15 页 PDF 的完整预览和 SVG 导出分别不超过 15 秒。
- [x] 解析和导出期间画板缩放、平移及窗口仍保持响应。
- [x] 用户取消后停止后续页面工作，不留下临时输出文件。
- [x] 预览采用可见性优先和有上限的缓存策略。
- [x] 常规 15 页场景内存目标低于 500MB，重复开关文档无持续增长。

## Verification

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- 528 / Chromium Docker 基准：首张预览 `170ms`，15 张完整预览 `772ms`，
  15 页矢量 SVG 导出 `111ms`；均包含浏览器、Worker 与文件下载路径。
- 预览和导出期间滚轮缩放立即生效；取消预览后停在 2 张，300ms 后无新增页面；
  取消 SVG 后没有触发浏览器下载。
- 初次 15 页常规场景 renderer RSS `425.99MB`、JS heap `8.28MB`。
- 多次 SVG 导出、工程重开后再连续打开两次的 renderer RSS 为
  `778.19MB → 771.32MB`，JS heap 为 `6.42MB → 6.53MB`，未持续增长。
  后者是经过多次矢量导出后的 WASM 线性内存高水位，不作为常规预览场景上限。
- 预览缓存上限为 18，IntersectionObserver 将可见缩略图插入 Worker 队首并在
  LRU 淘汰时保护可见页；store 测试覆盖 24 页输入和 URL 回收。

## Blocked by

- 001 导入 PDF 并显示页面预览
- 006 矢量 SVG 导出
