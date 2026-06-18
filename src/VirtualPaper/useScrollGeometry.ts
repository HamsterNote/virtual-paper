import { useEffect, useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import { computeScrollGeometry } from './scrollGeometry'
import type { ScrollGeometry } from './scrollGeometry'
import type { VirtualPaperContentSize, VirtualPaperTransform } from './types'

// scroll 模式的测量 + 几何计算 hook。
//
// 职责：
// 1. 测量 wrapper（视口）与 scaler（未缩放内容）的尺寸
// 2. 按 base size 优先级（contentSize prop > scaler.offset > {0,0}）解析基础尺寸
// 3. 调 computeScrollGeometry 计算 scrollSurface/scaledBox/scroll 同步参数
//
// 测量时机：
// - useLayoutEffect [enabled]：mount/enable 时同步测一次（commit 后立即读 DOM）
// - useEffect [enabled, contentSize]：ResizeObserver 监听后续尺寸变化
//   （contentSize 提供时不监听 scaler，因 base 尺寸已固定）
//
// v1 限制：contentSize 缺省时，VirtualPaper 会给 scaler 设 inline width/height（基于首次测量值）
//   以避免 0 尺寸。这会导致 children 后续 intrinsic 增长无法被 ResizeObserver 捕获（scaler 尺寸被
//   inline 固定）。动态尺寸内容请显式传 contentSize。
//
// geometry 每次渲染重算（computeScrollGeometry 是廉价纯算术，无需 useMemo）。

export type UseScrollGeometryArgs = {
  /** 是否启用 scroll 模式测量（renderMode === Scroll 时 true）。 */
  enabled: boolean
  /** wrapper（滚动视口）引用。 */
  wrapperRef: RefObject<HTMLDivElement | null>
  /** scaler 元素引用（用于测 offsetWidth/Height 作为基础内容尺寸）。 */
  measureRef: RefObject<HTMLDivElement | null>
  /** 显式基础内容尺寸；提供时优先于测量值。 */
  contentSize?: VirtualPaperContentSize
  /** 当前 transform。 */
  transform: VirtualPaperTransform
}

export type UseScrollGeometryResult = {
  /** scroll 几何参数（ready=false 表示尚未测量完成，调用方应跳过 scroll 同步）。 */
  geometry: ScrollGeometry
  /** 解析后的基础内容尺寸（已应用 contentSize > measured 优先级）。 */
  baseSize: { width: number; height: number }
}

export function useScrollGeometry({
  enabled,
  wrapperRef,
  measureRef,
  contentSize,
  transform
}: UseScrollGeometryArgs): UseScrollGeometryResult {
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [measured, setMeasured] = useState({ width: 0, height: 0 })

  // mount/enable 时同步测量一次：commit 后立即读 DOM，设 state 触发 re-render 反映初始几何
  useLayoutEffect(() => {
    if (!enabled) return
    const w = wrapperRef.current
    const m = measureRef.current
    if (w) {
      const nw = w.clientWidth
      const nh = w.clientHeight
      setViewport((prev) =>
        prev.width === nw && prev.height === nh
          ? prev
          : { width: nw, height: nh }
      )
    }
    if (m) {
      const nw = m.offsetWidth
      const nh = m.offsetHeight
      setMeasured((prev) =>
        prev.width === nw && prev.height === nh
          ? prev
          : { width: nw, height: nh }
      )
    }
  }, [enabled, wrapperRef, measureRef])

  // ResizeObserver 监听尺寸变化：wrapper 总是监听；scaler 仅在 contentSize 缺省时监听
  useEffect(() => {
    if (!enabled) return
    const targets: HTMLElement[] = []
    if (wrapperRef.current) targets.push(wrapperRef.current)
    const observeMeasure = !contentSize
    if (observeMeasure && measureRef.current) {
      targets.push(measureRef.current)
    }
    if (targets.length === 0) return

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const w = entry.contentRect.width
        const h = entry.contentRect.height
        if (el === wrapperRef.current) {
          setViewport((prev) =>
            prev.width === w && prev.height === h
              ? prev
              : { width: w, height: h }
          )
        } else if (el === measureRef.current) {
          setMeasured((prev) =>
            prev.width === w && prev.height === h
              ? prev
              : { width: w, height: h }
          )
        }
      }
    })
    for (const t of targets) ro.observe(t)
    return () => ro.disconnect()
  }, [enabled, contentSize, wrapperRef, measureRef])

  // base size 优先级：contentSize prop > scaler 测量值 > {0,0}
  const baseSize = contentSize ?? measured

  // geometry 每次渲染重算（纯算术，廉价）
  const geometry = computeScrollGeometry({ transform, baseSize, viewport })

  return { geometry, baseSize }
}
