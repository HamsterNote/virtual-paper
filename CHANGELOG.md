# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0-beta.1] - 2026-06-26

### 新增
- 添加 contain mode 约束模式，限制拖拽边界
- 添加惯性滚动和边缘弹性滚动功能（后移除惯性滚动）
- 添加 lazy will-change 支持，优化触摸手势性能
- 在演示控件中暴露 lazyWillChange 选项

### 变更
- 重构滚动模式为 reader mode，采用原生滚动
- 移除惯性滚动功能，优化边缘弹性滚动
- 多拖拽惯性模式现在始终处于禁用状态
- `edgeElasticScroll` 与 `readerMode` 继续保持支持

### 修复
- 修复 reader mode 原生滚动泄漏 transform-mode will-change 问题
- 修复边缘弹性回弹竞态问题并允许文字选择
- 修复 PR #2 代码审查发现的多个问题

### 移除
- 移除 `inertialScroll` 属性及相关支持
- 移除演示中惯性滚动的开关

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
