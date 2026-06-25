import { type VirtualPaperTransform } from './types'
import { projectContainTransform } from './transform'

const MIN_SAFE_RECT_SCALE = 0.01

const getMeasuredSize = (
  layoutSize: number,
  rectSize: number,
  scale: number
): number => {
  if (layoutSize > 0) return layoutSize
  if (rectSize <= 0 || !Number.isFinite(scale)) return 0
  // 对极小的 scale 做保守估计，避免直接放弃 containment。
  const safeScale = Math.max(scale, MIN_SAFE_RECT_SCALE)
  return rectSize / safeScale
}

/**
 * 测量 wrapper 和 container 的尺寸，返回有效的测量结果或 null。
 * container 使用 offsetWidth/offsetHeight（布局尺寸），fallback 到
 * getBoundingClientRect().width / scale 以补偿 transform 缩放。
 */
export function measureContainBox(
  wrapper: HTMLElement,
  container: HTMLElement,
  scale: number
): {
  wrapperWidth: number
  wrapperHeight: number
  containerWidth: number
  containerHeight: number
} | null {
  const wrapperWidth =
    wrapper.clientWidth || wrapper.getBoundingClientRect().width
  const wrapperHeight =
    wrapper.clientHeight || wrapper.getBoundingClientRect().height
  const containerRect = container.getBoundingClientRect()

  const containerWidth = getMeasuredSize(
    container.offsetWidth,
    containerRect.width,
    scale
  )
  const containerHeight = getMeasuredSize(
    container.offsetHeight,
    containerRect.height,
    scale
  )

  if (
    ![wrapperWidth, wrapperHeight, containerWidth, containerHeight].every(
      Number.isFinite
    )
  )
    return null
  if (
    wrapperWidth <= 0 ||
    wrapperHeight <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  )
    return null

  return { wrapperWidth, wrapperHeight, containerWidth, containerHeight }
}

/**
 * DOM-aware 版本的 projectContainTransform：
 * 先 measureContainBox，再调用纯 helper；测量失败时原样返回 transform。
 */
export function projectContainTransformForElements(
  transform: VirtualPaperTransform,
  wrapper: HTMLElement,
  container: HTMLElement
): VirtualPaperTransform {
  const box = measureContainBox(wrapper, container, transform.scale)
  if (!box) return transform
  return projectContainTransform(
    transform,
    { width: box.containerWidth, height: box.containerHeight },
    box.wrapperWidth,
    box.wrapperHeight
  )
}
