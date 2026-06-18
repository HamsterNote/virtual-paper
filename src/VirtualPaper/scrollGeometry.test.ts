import { describe, expect, it } from 'vitest'

import { computeScrollGeometry } from './scrollGeometry'

// S1 合同：computeScrollGeometry 必须满足不变式
//   originX - scrollLeft === transform.x  （任意 x：正/负/0/大/小）
//   originY - scrollTop  === transform.y
//   scrollLeft ∈ [0, surfaceWidth - viewport.width]  （可表示，不越界）
//   surfaceWidth >= originX + scaledWidth  （内容能放下）
//   ready === baseSize 与 viewport 均非零
//
// 这是 scroll 模式的几何基石：用 origin slack 让任意 {x,y} 可表示，
// 避免原生 scroll [0, max] 范围对 x>0 或小内容的限制。
describe('computeScrollGeometry', () => {
  const baseSize = { width: 400, height: 300 }
  const viewport = { width: 800, height: 600 }

  it('returns ready=false when base size is zero', () => {
    const result = computeScrollGeometry({
      transform: { x: 0, y: 0, scale: 1 },
      baseSize: { width: 0, height: 0 },
      viewport
    })
    expect(result.ready).toBe(false)
  })

  it('returns ready=false when viewport is zero', () => {
    const result = computeScrollGeometry({
      transform: { x: 0, y: 0, scale: 1 },
      baseSize,
      viewport: { width: 0, height: 0 }
    })
    expect(result.ready).toBe(false)
  })

  it('returns ready=true when base size and viewport are both positive', () => {
    const result = computeScrollGeometry({
      transform: { x: 0, y: 0, scale: 1 },
      baseSize,
      viewport
    })
    expect(result.ready).toBe(true)
  })

  it('satisfies scrollLeft = originX - x for x = 0', () => {
    const result = computeScrollGeometry({
      transform: { x: 0, y: 0, scale: 1 },
      baseSize,
      viewport
    })
    expect(result.originX - result.scrollLeft).toBe(0)
    expect(result.originY - result.scrollTop).toBe(0)
  })

  it('satisfies scrollLeft = originX - x for positive x', () => {
    const result = computeScrollGeometry({
      transform: { x: 100, y: 50, scale: 1 },
      baseSize,
      viewport
    })
    expect(result.originX - result.scrollLeft).toBe(100)
    expect(result.originY - result.scrollTop).toBe(50)
  })

  it('satisfies scrollLeft = originX - x for negative x (content shifted left of viewport)', () => {
    const result = computeScrollGeometry({
      transform: { x: -200, y: -150, scale: 1 },
      baseSize,
      viewport
    })
    expect(result.originX - result.scrollLeft).toBe(-200)
    expect(result.originY - result.scrollTop).toBe(-150)
  })

  it('satisfies scrollLeft = originX - x for large positive x beyond viewport', () => {
    const result = computeScrollGeometry({
      transform: { x: 5000, y: 4000, scale: 1 },
      baseSize,
      viewport
    })
    expect(result.originX - result.scrollLeft).toBe(5000)
    expect(result.originY - result.scrollTop).toBe(4000)
  })

  it('scales the content size by the scale factor in surface dimensions', () => {
    const result = computeScrollGeometry({
      transform: { x: 0, y: 0, scale: 2 },
      baseSize,
      viewport
    })
    // 缩放后内容 = 800 x 600；surface 必须至少容纳 originX + 缩放宽
    expect(result.surfaceWidth).toBeGreaterThanOrEqual(result.originX + 800)
    expect(result.surfaceHeight).toBeGreaterThanOrEqual(result.originY + 600)
  })

  it('keeps scrollLeft within scrollable range for x = 0', () => {
    const result = computeScrollGeometry({
      transform: { x: 0, y: 0, scale: 1 },
      baseSize,
      viewport
    })
    expect(result.scrollLeft).toBeGreaterThanOrEqual(0)
    expect(result.scrollLeft).toBeLessThanOrEqual(
      result.surfaceWidth - viewport.width
    )
    expect(result.scrollTop).toBeGreaterThanOrEqual(0)
    expect(result.scrollTop).toBeLessThanOrEqual(
      result.surfaceHeight - viewport.height
    )
  })

  it('keeps scrollTop within scrollable range for negative y', () => {
    const result = computeScrollGeometry({
      transform: { x: 0, y: -300, scale: 1 },
      baseSize,
      viewport
    })
    expect(result.scrollTop).toBeGreaterThanOrEqual(0)
    expect(result.scrollTop).toBeLessThanOrEqual(
      result.surfaceHeight - viewport.height
    )
  })

  it('keeps scrollLeft within range when content smaller than viewport (scale < 1)', () => {
    const result = computeScrollGeometry({
      transform: { x: 0, y: 0, scale: 0.5 },
      baseSize: { width: 100, height: 100 },
      viewport
    })
    expect(result.scrollLeft).toBeGreaterThanOrEqual(0)
    expect(result.scrollLeft).toBeLessThanOrEqual(
      result.surfaceWidth - viewport.width
    )
    // 内容左上角在视口位置仍等于 x
    expect(result.originX - result.scrollLeft).toBe(0)
  })

  it('keeps scrollLeft within range for large positive x', () => {
    const result = computeScrollGeometry({
      transform: { x: 5000, y: 4000, scale: 1 },
      baseSize,
      viewport
    })
    expect(result.scrollLeft).toBeGreaterThanOrEqual(0)
    expect(result.scrollLeft).toBeLessThanOrEqual(
      result.surfaceWidth - viewport.width
    )
  })

  it('preserves the content-position invariant across a scale change', () => {
    // 模拟锚点缩放：scale 变化导致 x 调整，但 originX - scrollLeft === x 始终成立
    const before = computeScrollGeometry({
      transform: { x: 100, y: 80, scale: 1 },
      baseSize,
      viewport
    })
    const after = computeScrollGeometry({
      transform: { x: 60, y: 40, scale: 2 },
      baseSize,
      viewport
    })
    expect(before.originX - before.scrollLeft).toBe(100)
    expect(after.originX - after.scrollLeft).toBe(60)
  })
})
