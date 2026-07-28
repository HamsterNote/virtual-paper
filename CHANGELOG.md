# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-28

### 新增
- reader mode 外部缩放预览（`readerModeExternalZoomPreview`）：在 reader mode 中通过 CSS transform 预览受控的外部缩放，并配有防抖提交周期
- 内部手势回显通过 `isTransformWithinEpsilon` 进行去重，避免与外部缩放产生冲突

### 修复
- 修复外部 reader 缩放提交时活跃缩放会话未正确取消导致的竞态问题
- 在触摸缩放和滚轮缩放交互中注入 `registerReaderZoomSessionCancel` 回调机制

## [1.0.0] - 2026-07-25

### 新增
- reader mode 支持原生滚动与触摸缩放
- reader mode 支持基于 CSS transform 的缩放预览

### 修复
- 改进 CI 发布流程中的 semver 解析与错误处理

## [0.2.0] - 2026-07-11

### 新增
- 新增 reader mode（阅读器模式）替代 scroll mode，支持原生滚动与弹性边缘
- 新增 contain mode（约束模式），支持 `containMarginX`/`containMarginY` 配置
- 新增 `lazyWillChange` 属性，优化触摸手势性能
- 新增演示面板中的 containMarginX/containMarginY 控制项
- 新增演示面板中的 lazyWillChange 控制项

### 变更
- 用 reader mode 替代 scroll mode
- 多拖拽惯性模式现在始终处于禁用状态
- `edgeElasticScroll` 与 `readerMode` 继续保持支持

### 移除
- 移除 `inertialScroll` 属性及相关支持
- 移除演示中惯性滚动的开关

### 修复
- 修复 PR #2 代码审查发现的多个问题
- 修复边缘弹性回弹竞态问题并允许文字选择
- 修复 reader mode 原生滚动泄漏 transform mode will-change 的问题
- 修复无效的 contain margins 并取消边距变化时的待处理 settle

## [0.1.0-beta.1] - 2026-06-18

### 新增
- 虚拟纸张组件，包含单元测试和端到端测试
- 基于 React 19 + TypeScript 6 + Vite 的项目初始化，含多拖拽演示
- 虚拟纸张的滚动渲染模式
- CI/CD 工作流，支持 PR 检查和基于 tag 的 NPM 发布

### 变更
- 简化滚动模式，采用原生滚动和双层 DOM 结构

### 修复
- 修复滚动处理器中的过期状态问题，更新文档
- 更新测试以匹配新的默认交互模式
- 绑定多拖拽 mixin 到 wrapper 以支持容器外的触摸事件
- 修复双指捏合缩放时的触摸结束跳动问题
