import type { VirtualPaperTransform } from './types'

// scroll 模式的几何计算工具。
//
// 核心问题：原生 scroll 位置 scrollLeft/scrollTop 只能在 [0, max] 范围内，
// 无法直接表示 transform.x 为正（内容左上角在视口右侧）或内容比视口小的情况。
//
// 解决方案：引入 origin slack —— 在内容左侧/上侧预留一块空间（originX/originY），
// 让 scrollLeft = originX - x 永远落在合法范围内。
//
// 不变式（scroll 模式的渲染合同）：
//   originX - scrollLeft === transform.x
//   originY - scrollTop  === transform.y
//   scrollLeft ∈ [0, surfaceWidth  - viewport.width]
//   scrollTop  ∈ [0, surfaceHeight - viewport.height]
//
// 这让交互层（hooks）的锚点数学 (localX - x) / scale 在 scroll 模式下依然成立，
// 因为无论用 transform 还是 scroll 实现，"内容左上角在视口的位置 === x" 始终为真。

/** computeScrollGeometry 的输入。 */
export type ScrollGeometryInput = {
  /** 当前 transform（与 transform 模式同语义：x,y = 内容左上角在视口的位置）。 */
  transform: VirtualPaperTransform
  /** 未缩放的内容基础尺寸（contentSize prop 或 scaler 的 offset 尺寸）。 */
  baseSize: { width: number; height: number }
  /** wrapper（滚动视口）的 client 尺寸。 */
  viewport: { width: number; height: number }
}

/** computeScrollGeometry 的输出。 */
export type ScrollGeometry = {
  /** 是否已就绪（baseSize 与 viewport 都非零时才能计算）。 */
  ready: boolean
  /** 内容左上角在 scrollSurface 中的 x 偏移（左侧 slack）。 */
  originX: number
  /** 内容左上角在 scrollSurface 中的 y 偏移（上侧 slack）。 */
  originY: number
  /** scrollSurface 的总宽度（撑开滚动区）。 */
  surfaceWidth: number
  /** scrollSurface 的总高度。 */
  surfaceHeight: number
  /** 应写入 wrapper.scrollLeft 的值（= originX - x）。 */
  scrollLeft: number
  /** 应写入 wrapper.scrollTop 的值（= originY - y）。 */
  scrollTop: number
}

// 单轴几何计算。
// 返回 [origin, surfaceSize, scroll] 三元组。
const computeAxis = (
  position: number,
  scaledSize: number,
  viewportSize: number
): { origin: number; surface: number; scroll: number } => {
  // origin 至少要容纳视口尺寸，且至少等于正方向的 position，
  // 这样无论 x 是正是负、是否超出视口，origin - x 都能表示。
  const origin = Math.max(viewportSize, Math.ceil(Math.max(position, 0)))

  // 尾部 slack：保证 scroll 不会触底（即 x 还能继续向负方向走）。
  // 至少留一个视口的余量，确保负向 panning 有空间。
  const tail = Math.max(
    viewportSize,
    Math.ceil(viewportSize - position - scaledSize)
  )

  const surface = origin + scaledSize + tail
  const scroll = origin - position

  return { origin, surface, scroll }
}

/**
 * 计算 scroll 模式下 wrapper/scrollSurface 的几何参数。
 *
 * 当 baseSize 或 viewport 任一维度为 0 时返回 ready:false（尚未测量完成），
 * 此时调用方应跳过 scroll 同步，避免在未就绪时写入错误的 scroll 位置。
 */
export const computeScrollGeometry = ({
  transform,
  baseSize,
  viewport
}: ScrollGeometryInput): ScrollGeometry => {
  const ready =
    baseSize.width > 0 &&
    baseSize.height > 0 &&
    viewport.width > 0 &&
    viewport.height > 0

  if (!ready) {
    return {
      ready: false,
      originX: 0,
      originY: 0,
      surfaceWidth: 0,
      surfaceHeight: 0,
      scrollLeft: 0,
      scrollTop: 0
    }
  }

  const scaledWidth = baseSize.width * transform.scale
  const scaledHeight = baseSize.height * transform.scale

  const xAxis = computeAxis(transform.x, scaledWidth, viewport.width)
  const yAxis = computeAxis(transform.y, scaledHeight, viewport.height)

  return {
    ready: true,
    originX: xAxis.origin,
    originY: yAxis.origin,
    surfaceWidth: xAxis.surface,
    surfaceHeight: yAxis.surface,
    scrollLeft: xAxis.scroll,
    scrollTop: yAxis.scroll
  }
}
