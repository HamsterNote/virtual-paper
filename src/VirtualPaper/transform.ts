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

// ---- Reader-mode geometry helpers ----

/**
 * 将 reader 模式的 transform 限制在合法范围内：
 * x ∈ [min(0, wrapperWidth - scaledWidth), 0]
 * y ∈ [min(0, wrapperHeight - scaledHeight), 0]
 */
export const clampReaderTransform = (
  transform: VirtualPaperTransform,
  contentSize: { width: number; height: number },
  wrapperWidth: number,
  wrapperHeight: number
): VirtualPaperTransform => {
  const scaledWidth = contentSize.width * transform.scale
  const scaledHeight = contentSize.height * transform.scale

  const minX = Math.min(0, wrapperWidth - scaledWidth)
  const minY = Math.min(0, wrapperHeight - scaledHeight)

  return {
    x: Math.min(Math.max(transform.x, minX), 0),
    y: Math.min(Math.max(transform.y, minY), 0),
    scale: transform.scale
  }
}

/**
 * 将 transform 转换为 layout 信息（尺寸 + 滚动位置），
 * 先 clamp 再计算 width/height/scrollLeft/scrollTop。
 */
export const convertTransformToLayout = (
  transform: VirtualPaperTransform,
  contentSize: { width: number; height: number },
  wrapperWidth: number,
  wrapperHeight: number
): {
  width: number
  height: number
  scrollLeft: number
  scrollTop: number
  boundedTransform: VirtualPaperTransform
} => {
  const boundedTransform = clampReaderTransform(
    transform,
    contentSize,
    wrapperWidth,
    wrapperHeight
  )

  const width = contentSize.width * boundedTransform.scale
  const height = contentSize.height * boundedTransform.scale

  return {
    width,
    height,
    scrollLeft: boundedTransform.x === 0 ? 0 : -boundedTransform.x,
    scrollTop: boundedTransform.y === 0 ? 0 : -boundedTransform.y,
    boundedTransform
  }
}

/**
 * 将 layout 的滚动位置转换回 transform 坐标。
 * width/height 仅用于对称性，不影响结果。
 */
export const convertLayoutToTransform = (
  _width: number,
  _height: number,
  scrollLeft: number,
  scrollTop: number,
  scale: number
): VirtualPaperTransform => {
  return {
    x: scrollLeft === 0 ? 0 : -scrollLeft,
    y: scrollTop === 0 ? 0 : -scrollTop,
    scale
  }
}

/**
 * 校验 reader 模式的 zoom debounce 值：
 * - undefined → 500（默认）
 * - 0 → 0（立即响应）
 * - 负数/Infinity/NaN → 500（无效值回退默认）
 * - 正数 → 原样返回
 */
export const validateReaderModeZoomDebounceMs = (
  value: number | undefined
): number => {
  if (value === undefined) return 500
  if (value === 0) return 0
  if (!Number.isFinite(value) || value < 0) return 500
  return value
}
