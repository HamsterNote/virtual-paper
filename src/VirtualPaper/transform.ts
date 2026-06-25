import {
  type VirtualPaperContentSize,
  type VirtualPaperTransform,
  VirtualPaperInitialPlacement
} from './types'

// allow: SIZE_OK — Existing transform helper module exceeds 250 pure LOC; this Todo is constrained to reader conversion semantics, and splitting exports belongs in a dedicated refactor.

type InitialTransformOptions = {
  placement: VirtualPaperInitialPlacement
  wrapperWidth: number
  wrapperHeight: number
  containerWidth: number
  containerHeight: number
}

export type ReaderLayoutMetrics = {
  readonly width: number
  readonly height: number
  readonly offsetX: number
  readonly offsetY: number
  readonly maxScrollLeft: number
  readonly maxScrollTop: number
  readonly scrollLeft: number
  readonly scrollTop: number
  readonly boundedTransform: VirtualPaperTransform
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

const zeroReaderLayoutMetrics = (): ReaderLayoutMetrics => {
  return {
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    maxScrollLeft: 0,
    maxScrollTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    boundedTransform: { x: 0, y: 0, scale: 0 }
  }
}

const isPositiveFiniteNumber = (value: number): boolean =>
  Number.isFinite(value) && value > 0

const safeTransformOffset = (value: number): number =>
  Number.isFinite(value) ? value : 0

// Reader 视觉居中只输出 layout offset；boundedTransform 只表达原生滚动范围。
export const computeReaderLayoutMetrics = (
  contentSize: VirtualPaperContentSize,
  scale: number,
  wrapperWidth: number,
  wrapperHeight: number,
  transform: VirtualPaperTransform
): ReaderLayoutMetrics => {
  if (
    !isPositiveFiniteNumber(contentSize.width) ||
    !isPositiveFiniteNumber(contentSize.height) ||
    !isPositiveFiniteNumber(scale) ||
    !isPositiveFiniteNumber(wrapperWidth) ||
    !isPositiveFiniteNumber(wrapperHeight)
  ) {
    return zeroReaderLayoutMetrics()
  }

  const width = contentSize.width * scale
  const height = contentSize.height * scale

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return zeroReaderLayoutMetrics()
  }

  const offsetX = Math.max((wrapperWidth - width) / 2, 0)
  const offsetY = Math.max((wrapperHeight - height) / 2, 0)
  const maxScrollLeft = Math.max(width - wrapperWidth, 0)
  const maxScrollTop = Math.max(height - wrapperHeight, 0)
  const desiredTransform = {
    x: safeTransformOffset(transform.x),
    y: safeTransformOffset(transform.y),
    scale
  }
  const boundedTransform = clampReaderTransform(
    desiredTransform,
    contentSize,
    wrapperWidth,
    wrapperHeight
  )

  return {
    width,
    height,
    offsetX,
    offsetY,
    maxScrollLeft,
    maxScrollTop,
    scrollLeft: boundedTransform.x === 0 ? 0 : -boundedTransform.x,
    scrollTop: boundedTransform.y === 0 ? 0 : -boundedTransform.y,
    boundedTransform
  }
}

/**
 * 纯几何 helper：将 transform 投影到 "contain" 约束下。
 * 当 container * scale <= wrapper 时居中；否则 clamp 到 [wrapper - scaledSize, 0]。
 * 不修改 scale，不进行四舍五入。
 */
export const projectContainTransform = (
  transform: VirtualPaperTransform,
  containerSize: { width: number; height: number },
  wrapperWidth: number,
  wrapperHeight: number
): VirtualPaperTransform => {
  const projectContainAxis = (
    desiredOffset: number,
    wrapperSize: number,
    containerSize: number,
    scale: number
  ): number => {
    // 任意维度非有限数 → 原样返回 desiredOffset，避免 NaN 传播
    if (
      ![desiredOffset, wrapperSize, containerSize, scale].every(Number.isFinite)
    )
      return desiredOffset
    // 零或负尺寸 → 原样返回 desiredOffset
    if (wrapperSize <= 0 || containerSize <= 0 || scale <= 0)
      return desiredOffset
    const scaledSize = containerSize * scale
    // container 缩放后 ≤ wrapper → 居中
    if (scaledSize <= wrapperSize) return (wrapperSize - scaledSize) / 2
    // container 缩放后 > wrapper → clamp 到 [wrapper - scaledSize, 0]
    return Math.min(Math.max(desiredOffset, wrapperSize - scaledSize), 0)
  }

  return {
    x: projectContainAxis(
      transform.x,
      wrapperWidth,
      containerSize.width,
      transform.scale
    ),
    y: projectContainAxis(
      transform.y,
      wrapperHeight,
      containerSize.height,
      transform.scale
    ),
    scale: transform.scale
  }
}

const CONTAIN_ELASTIC_RESISTANCE = 0.55

type ContainAxisBounds = {
  readonly min: number
  readonly max: number
}

type ElasticContainSize = {
  readonly width: number
  readonly height: number
}

export type ElasticContainResistanceOptions = {
  readonly transform: VirtualPaperTransform
  readonly containerSize: ElasticContainSize
  readonly wrapperSize: ElasticContainSize
  readonly enabled: boolean
}

export type ElasticContainResistanceResult = {
  readonly elasticTransform: VirtualPaperTransform
  readonly targetTransform: VirtualPaperTransform
}

const getContainAxisBounds = (
  desiredOffset: number,
  wrapperSize: number,
  containerSize: number,
  scale: number
): ContainAxisBounds | null => {
  if (
    ![desiredOffset, wrapperSize, containerSize, scale].every(Number.isFinite)
  )
    return null
  if (wrapperSize <= 0 || containerSize <= 0 || scale <= 0) return null

  const scaledSize = containerSize * scale
  if (!Number.isFinite(scaledSize)) return null
  if (scaledSize <= wrapperSize) {
    const centerOffset = (wrapperSize - scaledSize) / 2
    return { min: centerOffset, max: centerOffset }
  }

  return { min: wrapperSize - scaledSize, max: 0 }
}

const applyContainAxisResistance = (
  desiredOffset: number,
  targetOffset: number,
  bounds: ContainAxisBounds | null
): number => {
  if (!bounds) return targetOffset
  if (bounds.min === bounds.max) return targetOffset
  if (desiredOffset < bounds.min) {
    return (
      bounds.min + (desiredOffset - bounds.min) * CONTAIN_ELASTIC_RESISTANCE
    )
  }
  if (desiredOffset > bounds.max) {
    return (
      bounds.max + (desiredOffset - bounds.max) * CONTAIN_ELASTIC_RESISTANCE
    )
  }
  return desiredOffset
}

export const applyElasticContainResistance = ({
  transform,
  containerSize,
  wrapperSize,
  enabled
}: ElasticContainResistanceOptions): ElasticContainResistanceResult => {
  const targetTransform = projectContainTransform(
    transform,
    containerSize,
    wrapperSize.width,
    wrapperSize.height
  )

  if (!enabled) {
    return { elasticTransform: targetTransform, targetTransform }
  }

  return {
    elasticTransform: {
      x: applyContainAxisResistance(
        transform.x,
        targetTransform.x,
        getContainAxisBounds(
          transform.x,
          wrapperSize.width,
          containerSize.width,
          transform.scale
        )
      ),
      y: applyContainAxisResistance(
        transform.y,
        targetTransform.y,
        getContainAxisBounds(
          transform.y,
          wrapperSize.height,
          containerSize.height,
          transform.scale
        )
      ),
      scale: transform.scale
    },
    targetTransform
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
  const metrics = computeReaderLayoutMetrics(
    contentSize,
    transform.scale,
    wrapperWidth,
    wrapperHeight,
    transform
  )

  return {
    width: metrics.width,
    height: metrics.height,
    scrollLeft: metrics.scrollLeft,
    scrollTop: metrics.scrollTop,
    boundedTransform: metrics.boundedTransform
  }
}

export const convertReaderLayoutToTransform = (
  contentSize: VirtualPaperContentSize,
  scale: number,
  wrapperWidth: number,
  wrapperHeight: number,
  scrollLeft: number,
  scrollTop: number
): VirtualPaperTransform => {
  const desiredTransform = {
    x: scrollLeft === 0 ? 0 : -safeTransformOffset(scrollLeft),
    y: scrollTop === 0 ? 0 : -safeTransformOffset(scrollTop),
    scale
  }
  const metrics = computeReaderLayoutMetrics(
    contentSize,
    scale,
    wrapperWidth,
    wrapperHeight,
    desiredTransform
  )

  return metrics.boundedTransform
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
