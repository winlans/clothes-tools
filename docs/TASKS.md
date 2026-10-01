# 开发任务

任务按可独立验收的纵向切片组织。`AFK` 表示规格已经足够完整，可由开发者或
自动化代理独立实现；`HITL` 表示完成时需要人工执行安装或视觉验收。

| ID | 任务 | 类型 | 依赖 |
| --- | --- | --- | --- |
| 001 | [导入 PDF 并显示页面预览](../.scratch/tauri-vue-editor/001-pdf-import-preview.md) | AFK | 无 |
| 002 | [自动排版并显示 Vue 画板](../.scratch/tauri-vue-editor/002-auto-layout-canvas.md) | AFK | 001 |
| 003 | [拖拽吸附与插入式重排](../.scratch/tauri-vue-editor/003-drag-snap-reorder.md) | AFK | 002 |
| 004 | [空白占位与撤销重做](../.scratch/tauri-vue-editor/004-spacers-history.md) | AFK | 003 |
| 005 | [自动红线检测与裁切预览](../.scratch/tauri-vue-editor/005-guide-detection.md) | AFK | 001、002 |
| 006 | [矢量 SVG 导出](../.scratch/tauri-vue-editor/006-vector-svg-export.md) | AFK | 002、005 |
| 007 | [兼容现有 CLI](../.scratch/tauri-vue-editor/007-cli-compatibility.md) | AFK | 006 |
| 008 | [工程保存、重开与 PDF 重关联](../.scratch/tauri-vue-editor/008-project-persistence.md) | AFK | 004、005 |
| 009 | [高级接缝和导出选项](../.scratch/tauri-vue-editor/009-advanced-options.md) | AFK | 006、007 |
| 010 | [性能、取消与资源回收](../.scratch/tauri-vue-editor/010-performance-cancellation.md) | AFK | 001、006 |
| 011 | [Linux 安装包与发布验收](../.scratch/tauri-vue-editor/011-linux-release.md) | HITL | 007–010 |
| 012 | [从逐页红线自动识别每列页数](../.scratch/tauri-vue-editor/012-auto-column-height.md) | AFK | 002、005 |
| 013 | [压缩文档栏并统一布局控件](../.scratch/tauri-vue-editor/013-ui-density-polish.md) | AFK | 002、004 |
| 014 | [Windows x64 安装包发布](../.scratch/tauri-vue-editor/014-windows-release.md) | HITL | 007、010、013 |
| 015 | [CLI 内嵌 MuPDF WASM](../.scratch/tauri-vue-editor/015-embedded-cli-wasm.md) | AFK | 007、011、014 |
| 016 | [Linux 交叉生成 Windows 可视化安装包](../.scratch/tauri-vue-editor/016-windows-visual-nsis.md) | AFK | 014、015 |
| 017 | [全屏预览与精确百分比缩放](../.scratch/tauri-vue-editor/017-fullscreen-precise-zoom.md) | AFK | 002、013 |

建议按编号顺序领取；没有直接依赖关系的任务可并行，例如 004 与 005、008 与
009。每个任务的验收标准是完成条件，不以“代码已写完”代替可运行验证。
