import { useEffect, useRef } from 'react'

/**
 * Demo 专用的 transform-origin 可视化点位。
 *
 * 点位作为 VirtualPaper container 的直接子元素，left/top 与容器的
 * transform-origin 共用同一套局部坐标。直接观察最终 DOM 样式，可以避免
 * 在 Demo 中复制阅读模式的滚动偏移和缩放锚点计算。
 */
export function ReaderTransformOriginDebugPoint() {
  const markerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const marker = markerRef.current
    const container = marker?.parentElement
    if (!marker || !container) return

    const syncWithTransformOrigin = () => {
      const originValues = window
        .getComputedStyle(container)
        .transformOrigin.split(' ')
      const originX = Number.parseFloat(originValues[0] ?? '')
      const originY = Number.parseFloat(originValues[1] ?? '')
      if (!Number.isFinite(originX) || !Number.isFinite(originY)) return

      marker.style.left = `${originX}px`
      marker.style.top = `${originY}px`
    }

    syncWithTransformOrigin()

    const observer = new MutationObserver(syncWithTransformOrigin)
    observer.observe(container, {
      attributes: true,
      attributeFilter: ['style']
    })

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={markerRef}
      aria-hidden="true"
      className="reader-transform-origin-debug-point"
      data-testid="reader-transform-origin-debug-point"
    />
  )
}
