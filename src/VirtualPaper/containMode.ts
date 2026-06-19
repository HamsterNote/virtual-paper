import { type VirtualPaperTransform } from './types'
import { projectContainTransform } from './transform'

/**
 * 测量 wrapper 和 container 的尺寸，返回有效的测量结果或 null。
 * container 使用 offsetWidth/offsetHeight（布局尺寸），fallback 到
 * getBoundingClientRect().width / Math.max(scale, 0.000001) 以补偿 transform 缩放。
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
  const wrapperWidth = wrapper.clientWidth || wrapper.getBoundingClientRect().width
  const wrapperHeight = wrapper.clientHeight || wrapper.getBoundingClientRect().height

  const containerWidth =
    container.offsetWidth || container.getBoundingClientRect().width / Math.max(scale, 0.000001)
  const containerHeight =
    container.offsetHeight || container.getBoundingClientRect().height / Math.max(scale, 0.000001)

  if (![wrapperWidth, wrapperHeight, containerWidth, containerHeight].every(Number.isFinite))
    return null
  if (wrapperWidth <= 0 || wrapperHeight <= 0 || containerWidth <= 0 || containerHeight <= 0)
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
