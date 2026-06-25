import type { VirtualPaperTransform } from './types'

type EaseAnimationOptions = {
  readonly from: VirtualPaperTransform
  readonly to: VirtualPaperTransform
  readonly duration?: number
  readonly onUpdate: (transform: VirtualPaperTransform) => void
  readonly onComplete?: () => void
}

/** easeOutCubic: 快速启动、缓慢结束的缓动函数 */
const easeOutCubic = (t: number): number => {
  const inv = 1 - t
  return 1 - inv * inv * inv
}

const lerp = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress

/**
 * 创建基于时间的缓动动画。
 * 使用 easeOutCubic 实现单调收敛，不产生过冲或振荡。
 *
 * @returns cancel 函数 — 调用后立即停止动画，不再触发 onUpdate / onComplete。
 */
export const createEaseAnimation = ({
  from,
  to,
  duration = 220,
  onUpdate,
  onComplete
}: EaseAnimationOptions): (() => void) => {
  let frameId: number | null = null
  let cancelled = false
  let frameCount = 0

  const step = () => {
    if (cancelled) return

    frameCount++
    const elapsed = frameCount * 16
    const raw = elapsed / duration
    const t = raw >= 1 ? 1 : easeOutCubic(raw)

    onUpdate({
      x: lerp(from.x, to.x, t),
      y: lerp(from.y, to.y, t),
      scale: lerp(from.scale, to.scale, t)
    })

    if (t >= 1) {
      onComplete?.()
      return
    }

    frameId = window.requestAnimationFrame(step)
  }

  onUpdate(from)

  frameId = window.requestAnimationFrame(step)

  return () => {
    cancelled = true
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
  }
}

/**
 * @deprecated 使用 `createEaseAnimation` 替代。
 * 保留此别名以兼容现有导入，行为已改为 ease 缓动。
 */
export const createSpringAnimation = createEaseAnimation
