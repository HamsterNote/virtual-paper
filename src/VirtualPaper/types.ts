import type * as React from 'react'

export enum VirtualPaperInteractionMode {
  MouseWheelZoom = 'MouseWheelZoom',
  MouseDragPan = 'MouseDragPan',
  TrackpadScrollPan = 'TrackpadScrollPan',
  MouseWheelCtrlZoom = 'MouseWheelCtrlZoom',
  TouchSingleFingerPan = 'TouchSingleFingerPan',
  TouchTwoFingerPan = 'TouchTwoFingerPan',
  TouchTwoFingerZoom = 'TouchTwoFingerZoom',
  PenPan = 'PenPan'
}

export enum VirtualPaperInitialPlacement {
  TopLeft = 'TopLeft',
  Center = 'Center'
}

/**
 * @deprecated Use `readerMode` instead. `VirtualPaperRenderMode.Scroll` maps to
 * `readerMode = true`, and `VirtualPaperRenderMode.Transform` maps to the default
 * transform-based rendering. This enum is kept for backward compatibility and will
 * be removed in a future major version.
 */
export enum VirtualPaperRenderMode {
  Transform = 'Transform',
  Scroll = 'Scroll'
}

export type VirtualPaperTransform = { x: number; y: number; scale: number }

/**
 * reader 模式下内容的未缩放基础尺寸。
 *
 * reader 模式必须知道内容的原始尺寸才能计算 container 的宽高（= 基础 × scale）。
 * 必须由调用方显式提供：未提供时退化为 wrapper 尺寸，
 * 缩放与原生滚动几何将不会按预期工作。
 */
export type VirtualPaperContentSize = { width: number; height: number }

export type VirtualPaperTransformMeta = {
  source:
    | VirtualPaperInteractionMode
    | 'initialPlacement'
    | 'controlledProp'
    | 'reset'
  inputType: 'wheel' | 'pointer' | 'programmatic'
  phase: 'change' | 'end'
  originalEventType?: string
}

export type VirtualPaperProps = {
  children?: React.ReactNode
  enabledInteractions?: VirtualPaperInteractionMode[]
  initialPlacement?: VirtualPaperInitialPlacement
  /**
   * reader 模式下内容的未缩放基础尺寸。
   */
  contentSize?: VirtualPaperContentSize
  /**
   * @deprecated Use `readerMode` instead. `VirtualPaperRenderMode.Scroll` is
   * equivalent to `readerMode = true`, and `VirtualPaperRenderMode.Transform`
   * is equivalent to the default transform-based rendering. When both are
   * provided, `readerMode` takes precedence.
   */
  renderMode?: VirtualPaperRenderMode
  /**
   * 阅读模式。默认 false。
   * 开启后使用原生滚动几何，适合文档阅读、PDF 阅读等场景。
   */
  readerMode?: boolean
  /**
   * 非阅读模式下启用 contain 约束；默认 false。readerMode 为 true 时忽略。
   */
  containMode?: boolean
  /**
   * 启用边缘弹性滚动；默认 false。这里只暴露 API 开关，具体行为由交互 hook 决定。
   */
  edgeElasticScroll?: boolean
  /**
   * 阅读模式下的缩放防抖时间（毫秒）。
   * 默认 500ms。仅在 readerMode 为 true 时生效。
   */
  readerModeZoomDebounceMs?: number
  /**
   * 延迟启用 will-change: transform 的交互阈值。
   * 默认 0 表示默认不主动设置 will-change；正值表示当缩放比例
   * 超过该阈值时由组件动态应用，用于优化大画布缩放性能。
   */
  lazyWillChange?: number
  transform?: VirtualPaperTransform
  defaultTransform?: Partial<VirtualPaperTransform>
  minScale?: number
  maxScale?: number
  onTransformChange?: (
    transform: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => void
  onTransformChangeEnd?: (
    transform: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => void
  className?: string
  style?: React.CSSProperties
  containerClassName?: string
  containerStyle?: React.CSSProperties
  wrapperProps?: React.HTMLAttributes<HTMLDivElement>
  containerProps?: React.HTMLAttributes<HTMLDivElement>
}

export type VirtualPaperTransformUpdater = (
  next: VirtualPaperTransform,
  meta: VirtualPaperTransformMeta
) => void

export type UseVirtualPaperInteractionArgs = {
  wrapperRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  transform: VirtualPaperTransform
  enabledInteractions: VirtualPaperInteractionMode[]
  minScale: number
  maxScale: number
  contentSize?: VirtualPaperContentSize
  updateTransform: VirtualPaperTransformUpdater
  endTransform: VirtualPaperTransformUpdater
  /**
   * 阅读模式下为 true。
   */
  isReaderMode?: boolean
  /**
   * 非阅读模式下启用 contain 约束；默认 false。isReaderMode 为 true 时忽略。
   */
  containMode?: boolean
  /**
   * 启用边缘弹性滚动；默认 false。
   */
  edgeElasticScroll?: boolean
  /**
   * 标记一次弹性交互开始。每个调用必须对应一次 `decrementElasticActive`。
   */
  incrementElasticActive?: () => void
  /**
   * 标记一次弹性交互结束。必须与之前的 `incrementElasticActive` 配对调用。
   */
  decrementElasticActive?: () => void
  /**
   * 阅读模式下的缩放防抖时间（毫秒）。
   * 默认 500ms。仅在 isReaderMode 为 true 时生效。
   */
  readerModeZoomDebounceMs?: number
}

export const DEFAULT_ENABLED_INTERACTIONS = [
  VirtualPaperInteractionMode.TrackpadScrollPan,
  VirtualPaperInteractionMode.MouseWheelCtrlZoom,
  VirtualPaperInteractionMode.TouchSingleFingerPan,
  VirtualPaperInteractionMode.TouchTwoFingerZoom
]

export const READER_MODE_NATIVE_TOUCH_ACTION = 'pan-x pan-y'
