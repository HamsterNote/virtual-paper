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
 * 渲染模式（独立于交互模式 InteractionMode 的维度）。
 *
 * - Transform：默认。用 CSS `transform: translate3d + scale` 驱动平移与缩放。
 * - Scroll：用改变 container 宽高来表示 scale、改变 wrapper.scrollLeft/Top
 *   来表示 translate。适合需要原生 scroll 几何（如与其他滚动容器联动）的场景。
 */
export enum VirtualPaperRenderMode {
  Transform = 'Transform',
  Scroll = 'Scroll'
}

export type VirtualPaperTransform = { x: number; y: number; scale: number }

/**
 * scroll 模式下内容的未缩放基础尺寸。
 *
 * scroll 模式必须知道内容的原始尺寸才能计算 container 的宽高（= 基础 × scale）。
 * 若未提供，组件会通过 ResizeObserver 测量 scaler 元素的 offset 尺寸；
 * 但当 children 为绝对定位等不参与正常流时，测量可能为 0，此时应显式提供。
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
   * 渲染模式。默认 Transform（CSS transform）。
   * Scroll 模式用 container 宽高 + wrapper scroll 几何实现相同的 pan/zoom 语义。
   * 两种模式下 {x,y,scale} 状态语义完全一致，运行时切换会平滑保留状态。
   */
  renderMode?: VirtualPaperRenderMode
  /**
   * scroll 模式下内容的未缩放基础尺寸。
   * 未提供时通过 ResizeObserver 测量；对不参与正常流的 children 建议显式提供。
   * 仅在 renderMode === Scroll 时生效。
   */
  contentSize?: VirtualPaperContentSize
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
  updateTransform: VirtualPaperTransformUpdater
  endTransform: VirtualPaperTransformUpdater
  /**
   * scroll 渲染模式下为 true。
   * wheel hook 在 scroll 模式下：非 ctrl/meta 的 wheel 交给原生滚动（不 preventDefault），
   * 仅 ctrl/meta + wheel 触发 JS zoom。
   */
  isScrollMode?: boolean
}

export const DEFAULT_ENABLED_INTERACTIONS = [
  VirtualPaperInteractionMode.TrackpadScrollPan,
  VirtualPaperInteractionMode.MouseWheelCtrlZoom,
  VirtualPaperInteractionMode.TouchSingleFingerPan,
  VirtualPaperInteractionMode.TouchTwoFingerZoom
]
