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
}

export const DEFAULT_ENABLED_INTERACTIONS = [
  VirtualPaperInteractionMode.TrackpadScrollPan,
  VirtualPaperInteractionMode.MouseWheelCtrlZoom,
  VirtualPaperInteractionMode.TouchTwoFingerPan,
  VirtualPaperInteractionMode.TouchTwoFingerZoom
]
