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
   * 阅读模式。默认 false。
   * 开启后使用原生滚动几何，适合文档阅读、PDF 阅读等场景。
   */
  readerMode?: boolean
  /**
   * 阅读模式下的缩放防抖时间（毫秒）。
   * 默认 500ms。仅在 readerMode 为 true 时生效。
   */
  readerModeZoomDebounceMs?: number
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
