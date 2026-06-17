import {
  type VirtualPaperTransform,
  VirtualPaperInitialPlacement
} from './types'

type InitialTransformOptions = {
  placement: VirtualPaperInitialPlacement
  wrapperWidth: number
  wrapperHeight: number
  containerWidth: number
  containerHeight: number
}

export const clampScale = (scale: number, min: number, max: number): number => {
  return Math.min(Math.max(scale, min), max)
}

export const getInitialTransform = ({
  placement,
  wrapperWidth,
  wrapperHeight,
  containerWidth,
  containerHeight
}: InitialTransformOptions): VirtualPaperTransform => {
  if (placement === VirtualPaperInitialPlacement.TopLeft) {
    return { x: 0, y: 0, scale: 1 }
  }

  return {
    x: (wrapperWidth - containerWidth) / 2,
    y: (wrapperHeight - containerHeight) / 2,
    scale: 1
  }
}

export const serializeTransform = ({
  x,
  y,
  scale
}: VirtualPaperTransform): string => {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`
}

export const applyZoomAnchor = (
  current: VirtualPaperTransform,
  nextScale: number,
  localX: number,
  localY: number
): VirtualPaperTransform => {
  const contentX = (localX - current.x) / current.scale
  const contentY = (localY - current.y) / current.scale

  return {
    x: localX - contentX * nextScale,
    y: localY - contentY * nextScale,
    scale: nextScale
  }
}

export const mergeDefaultTransform = (
  initial: VirtualPaperTransform,
  override: Partial<VirtualPaperTransform> | undefined,
  minScale: number,
  maxScale: number
): VirtualPaperTransform => {
  const merged = {
    ...initial,
    ...override
  }

  return {
    ...merged,
    scale: clampScale(merged.scale, minScale, maxScale)
  }
}
