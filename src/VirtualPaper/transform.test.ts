import { describe, expect, it } from 'vitest'

// allow: SIZE_OK — Existing transform helper suite is intentionally kept together for this Todo; split in a dedicated refactor.

import {
  applyElasticContainResistance,
  applyZoomAnchor,
  clampScale,
  clampReaderTransform,
  computeReaderLayoutMetrics,
  convertReaderLayoutToTransform,
  convertTransformToLayout,
  convertLayoutToTransform,
  getInitialTransform,
  mergeDefaultTransform,
  projectContainTransform,
  serializeTransform,
  validateReaderModeZoomDebounceMs
} from './transform'
import { VirtualPaperInitialPlacement } from './types'

describe('clampScale', () => {
  it('clamps values below the minimum scale', () => {
    expect(clampScale(0.1, 0.25, 4)).toBe(0.25)
  })

  it('clamps values above the maximum scale', () => {
    expect(clampScale(8, 0.25, 4)).toBe(4)
  })

  it('keeps values inside the scale range', () => {
    expect(clampScale(2, 0.25, 4)).toBe(2)
  })
})

describe('getInitialTransform', () => {
  it('centers the container inside the wrapper', () => {
    expect(
      getInitialTransform({
        placement: VirtualPaperInitialPlacement.Center,
        wrapperWidth: 800,
        wrapperHeight: 600,
        containerWidth: 400,
        containerHeight: 300
      })
    ).toEqual({ x: 200, y: 150, scale: 1 })
  })

  it('places the container at the top left', () => {
    expect(
      getInitialTransform({
        placement: VirtualPaperInitialPlacement.TopLeft,
        wrapperWidth: 800,
        wrapperHeight: 600,
        containerWidth: 400,
        containerHeight: 300
      })
    ).toEqual({ x: 0, y: 0, scale: 1 })
  })
})

describe('serializeTransform', () => {
  it('serializes translate and scale into a CSS transform string', () => {
    expect(serializeTransform({ x: 10, y: 20, scale: 2 })).toBe(
      'translate3d(10px, 20px, 0) scale(2)'
    )
  })

  it('serializes negative coordinates and decimal scale without rounding', () => {
    expect(serializeTransform({ x: -12.5, y: -0.75, scale: 1.2345 })).toBe(
      'translate3d(-12.5px, -0.75px, 0) scale(1.2345)'
    )
  })
})

describe('applyZoomAnchor', () => {
  it('keeps the content point under the cursor while zooming', () => {
    const current = { x: 100, y: 50, scale: 1 }
    const localX = 25
    const localY = 10
    const anchored = applyZoomAnchor(current, 2, localX, localY)

    expect(anchored.scale).toBe(2)

    // content point under cursor must stay at same viewport position
    const contentX = (localX - current.x) / current.scale
    const contentY = (localY - current.y) / current.scale

    expect(anchored.x + contentX * anchored.scale).toBe(
      current.x + contentX * current.scale
    )
    expect(anchored.y + contentY * anchored.scale).toBe(
      current.y + contentY * current.scale
    )
  })
})

describe('mergeDefaultTransform', () => {
  it('overlays override fields and clamps override scale', () => {
    expect(
      mergeDefaultTransform(
        { x: 200, y: 150, scale: 1 },
        { y: 12, scale: 8 },
        0.25,
        4
      )
    ).toEqual({ x: 200, y: 12, scale: 4 })
  })

  it('clamps the initial scale when no override is provided', () => {
    expect(
      mergeDefaultTransform({ x: 0, y: 0, scale: 0.1 }, undefined, 0.25, 4)
    ).toEqual({ x: 0, y: 0, scale: 0.25 })
  })
})

// 公共 fixture: contentSize 1000x2000, wrapper 500x500
const readerContentSize = { width: 1000, height: 2000 }
const readerWrapperWidth = 500
const readerWrapperHeight = 500

describe('clampReaderTransform', () => {
  // scale=0.25 → 输出 250x500 (fits wrapper), x/y clamp to 0
  it('clamps x/y to 0 when content (1000x2000 @ scale=0.25 = 250x500) fits wrapper (500x500)', () => {
    const transform = { x: -50, y: -100, scale: 0.25 }
    const result = clampReaderTransform(
      transform,
      readerContentSize,
      readerWrapperWidth,
      readerWrapperHeight
    )
    expect(result).toEqual({ x: 0, y: 0, scale: 0.25 })
  })

  // scale=0.5 → 输出 500x1000; x: 500==wrapper → clamp 0; y: 1000-500=500 scrollable
  it('clamps x=0, y∈[-500,0] when content (1000x2000 @ scale=0.5 = 500x1000) partially overflows wrapper (500x500)', () => {
    const transform = { x: -10, y: -600, scale: 0.5 }
    const result = clampReaderTransform(
      transform,
      readerContentSize,
      readerWrapperWidth,
      readerWrapperHeight
    )
    expect(result.x).toBe(0)
    expect(result.y).toBe(-500)
    expect(result.scale).toBe(0.5)
  })

  it('allows y within legal bounds at scale=0.5 (content 500x1000, wrapper 500x500)', () => {
    const transform = { x: 0, y: -250, scale: 0.5 }
    const result = clampReaderTransform(
      transform,
      readerContentSize,
      readerWrapperWidth,
      readerWrapperHeight
    )
    expect(result).toEqual({ x: 0, y: -250, scale: 0.5 })
  })

  // scale=2 → 输出 2000x4000; x clamp [-1500,0] (2000-500); y clamp [-3500,0] (4000-500)
  it('clamps x∈[-1500,0], y∈[-3500,0] when content (1000x2000 @ scale=2 = 2000x4000) heavily overflows wrapper (500x500)', () => {
    const transform = { x: -2000, y: -4000, scale: 2 }
    const result = clampReaderTransform(
      transform,
      readerContentSize,
      readerWrapperWidth,
      readerWrapperHeight
    )
    expect(result.x).toBe(-1500)
    expect(result.y).toBe(-3500)
    expect(result.scale).toBe(2)
  })

  it('clamps positive x/y to 0 at scale=2 (cannot scroll past origin)', () => {
    const transform = { x: 100, y: 200, scale: 2 }
    const result = clampReaderTransform(
      transform,
      readerContentSize,
      readerWrapperWidth,
      readerWrapperHeight
    )
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
    expect(result.scale).toBe(2)
  })
})

describe('computeReaderLayoutMetrics', () => {
  it('returns positive offsets and zero scroll ranges when both axes fit', () => {
    const result = computeReaderLayoutMetrics(
      { width: 200, height: 100 },
      1,
      800,
      600,
      { x: -50, y: -25, scale: 1 }
    )

    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
    expect(result.offsetX).toBe(300)
    expect(result.offsetY).toBe(250)
    expect(result.maxScrollLeft).toBe(0)
    expect(result.maxScrollTop).toBe(0)
    expect(result.scrollLeft).toBe(0)
    expect(result.scrollTop).toBe(0)
    expect(result.boundedTransform).toEqual({ x: 0, y: 0, scale: 1 })
  })

  it('keeps X overflow scrollable while centering fitting Y independently', () => {
    const result = computeReaderLayoutMetrics(
      { width: 1200, height: 100 },
      1,
      800,
      600,
      { x: -999, y: -25, scale: 1 }
    )

    expect(result.width).toBe(1200)
    expect(result.height).toBe(100)
    expect(result.offsetX).toBe(0)
    expect(result.offsetY).toBe(250)
    expect(result.maxScrollLeft).toBe(400)
    expect(result.maxScrollTop).toBe(0)
    expect(result.scrollLeft).toBe(400)
    expect(result.scrollTop).toBe(0)
    expect(result.boundedTransform).toEqual({ x: -400, y: 0, scale: 1 })
  })

  it('centers fitting X while keeping Y overflow scrollable independently', () => {
    const result = computeReaderLayoutMetrics(
      { width: 200, height: 900 },
      1,
      800,
      600,
      { x: -50, y: -999, scale: 1 }
    )

    expect(result.width).toBe(200)
    expect(result.height).toBe(900)
    expect(result.offsetX).toBe(300)
    expect(result.offsetY).toBe(0)
    expect(result.maxScrollLeft).toBe(0)
    expect(result.maxScrollTop).toBe(300)
    expect(result.scrollLeft).toBe(0)
    expect(result.scrollTop).toBe(300)
    expect(result.boundedTransform).toEqual({ x: 0, y: -300, scale: 1 })
  })

  it('returns zero offsets and positive scroll ranges when both axes overflow', () => {
    const result = computeReaderLayoutMetrics(
      { width: 1200, height: 900 },
      1,
      800,
      600,
      { x: -250, y: -125, scale: 1 }
    )

    expect(result.width).toBe(1200)
    expect(result.height).toBe(900)
    expect(result.offsetX).toBe(0)
    expect(result.offsetY).toBe(0)
    expect(result.maxScrollLeft).toBe(400)
    expect(result.maxScrollTop).toBe(300)
    expect(result.scrollLeft).toBe(250)
    expect(result.scrollTop).toBe(125)
    expect(result.boundedTransform).toEqual({ x: -250, y: -125, scale: 1 })
  })

  it('returns safe zeros without NaN for invalid or zero dimensions', () => {
    const result = computeReaderLayoutMetrics(
      { width: Number.NaN, height: 0 },
      Number.POSITIVE_INFINITY,
      0,
      Number.NaN,
      {
        x: Number.NaN,
        y: Number.NEGATIVE_INFINITY,
        scale: Number.POSITIVE_INFINITY
      }
    )

    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
    expect(result.offsetX).toBe(0)
    expect(result.offsetY).toBe(0)
    expect(result.maxScrollLeft).toBe(0)
    expect(result.maxScrollTop).toBe(0)
    expect(result.scrollLeft).toBe(0)
    expect(result.scrollTop).toBe(0)
    expect(result.boundedTransform).toEqual({ x: 0, y: 0, scale: 0 })
    expect(Object.values(result).some(Number.isNaN)).toBe(false)
  })
})

describe('convertTransformToLayout', () => {
  it('returns bounded layout size 250x500 with scroll=0 for scale=0.25 (content fits wrapper)', () => {
    const transform = { x: 0, y: 0, scale: 0.25 }
    const result = convertTransformToLayout(
      transform,
      readerContentSize,
      readerWrapperWidth,
      readerWrapperHeight
    )
    expect(result.width).toBe(250)
    expect(result.height).toBe(500)
    expect(result.scrollLeft).toBe(0)
    expect(result.scrollTop).toBe(0)
    expect(result.boundedTransform).toEqual({ x: 0, y: 0, scale: 0.25 })
  })

  it('returns bounded layout size 500x1000 with clamped scroll for scale=0.5', () => {
    const transform = { x: -200, y: -300, scale: 0.5 }
    const result = convertTransformToLayout(
      transform,
      readerContentSize,
      readerWrapperWidth,
      readerWrapperHeight
    )
    expect(result.width).toBe(500)
    expect(result.height).toBe(1000)
    expect(result.scrollLeft).toBe(0)
    expect(result.scrollTop).toBe(300)
    expect(result.boundedTransform.x).toBe(0)
    expect(result.boundedTransform.y).toBe(-300)
  })

  it('returns bounded layout size 2000x4000 with clamped scroll for scale=2', () => {
    const transform = { x: -500, y: -1000, scale: 2 }
    const result = convertTransformToLayout(
      transform,
      readerContentSize,
      readerWrapperWidth,
      readerWrapperHeight
    )
    expect(result.width).toBe(2000)
    expect(result.height).toBe(4000)
    expect(result.scrollLeft).toBe(500)
    expect(result.scrollTop).toBe(1000)
    expect(result.boundedTransform).toEqual({ x: -500, y: -1000, scale: 2 })
  })
})

describe('convertLayoutToTransform', () => {
  it('converts layout scroll position back to negative transform coordinates', () => {
    const result = convertLayoutToTransform(2000, 4000, 500, 1000, 2)
    expect(result).toEqual({ x: -500, y: -1000, scale: 2 })
  })

  it('converts zero scroll to zero transform offset', () => {
    const result = convertLayoutToTransform(250, 500, 0, 0, 0.25)
    expect(result).toEqual({ x: 0, y: 0, scale: 0.25 })
  })

  it('ignores width/height and maps scrollLeft/scrollTop to -x/-y', () => {
    const result = convertLayoutToTransform(500, 1000, 0, 250, 0.5)
    expect(result.x).toBe(0)
    expect(result.y).toBe(-250)
    expect(result.scale).toBe(0.5)
  })
})

describe('reader transform/layout conversion roundtrip', () => {
  it('keeps both fit axes at zero scroll and zero transform while offsets remain layout-only', () => {
    // Given: scaled content fits both axes and has visible center offsets.
    const contentSize = { width: 200, height: 100 }
    const wrapperWidth = 800
    const wrapperHeight = 600
    const transform = { x: -300, y: -250, scale: 1 }

    // When: transform is projected to native layout and then back to reader transform.
    const layout = convertTransformToLayout(
      transform,
      contentSize,
      wrapperWidth,
      wrapperHeight
    )
    const roundtrip = convertReaderLayoutToTransform(
      contentSize,
      transform.scale,
      wrapperWidth,
      wrapperHeight,
      layout.scrollLeft,
      layout.scrollTop
    )
    const metrics = computeReaderLayoutMetrics(
      contentSize,
      transform.scale,
      wrapperWidth,
      wrapperHeight,
      transform
    )

    // Then: visual centering stays in offsets, never in scroll or pan transform.
    expect(metrics.offsetX).toBe(300)
    expect(metrics.offsetY).toBe(250)
    expect(layout.scrollLeft).toBe(0)
    expect(layout.scrollTop).toBe(0)
    expect(layout.boundedTransform).toEqual({ x: 0, y: 0, scale: 1 })
    expect(roundtrip).toEqual({ x: 0, y: 0, scale: 1 })
    expect(roundtrip.x).not.toBe(-metrics.offsetX)
    expect(roundtrip.y).not.toBe(-metrics.offsetY)
  })

  it('roundtrips X overflow while independently keeping fit Y out of scroll and transform', () => {
    // Given: only X overflows; Y has a positive visual centering offset.
    const contentSize = { width: 1200, height: 100 }
    const wrapperWidth = 800
    const wrapperHeight = 600
    const transform = { x: -250, y: -999, scale: 1 }

    // When: conversion goes transform -> native scroll -> reader transform.
    const layout = convertTransformToLayout(
      transform,
      contentSize,
      wrapperWidth,
      wrapperHeight
    )
    const roundtrip = convertReaderLayoutToTransform(
      contentSize,
      transform.scale,
      wrapperWidth,
      wrapperHeight,
      layout.scrollLeft,
      layout.scrollTop
    )
    const metrics = computeReaderLayoutMetrics(
      contentSize,
      transform.scale,
      wrapperWidth,
      wrapperHeight,
      transform
    )

    // Then: X keeps -x === scrollLeft, while fit Y stays exactly zero.
    expect(metrics.offsetY).toBe(250)
    expect(layout.scrollLeft).toBe(250)
    expect(layout.scrollTop).toBe(0)
    expect(layout.boundedTransform).toEqual({ x: -250, y: 0, scale: 1 })
    expect(roundtrip).toEqual({ x: -250, y: 0, scale: 1 })
    expect(layout.scrollTop).not.toBe(metrics.offsetY)
  })

  it('roundtrips Y overflow while independently keeping fit X out of scroll and transform', () => {
    // Given: only Y overflows; X has a positive visual centering offset.
    const contentSize = { width: 200, height: 900 }
    const wrapperWidth = 800
    const wrapperHeight = 600
    const transform = { x: -999, y: -125, scale: 1 }

    // When: conversion goes transform -> native scroll -> reader transform.
    const layout = convertTransformToLayout(
      transform,
      contentSize,
      wrapperWidth,
      wrapperHeight
    )
    const roundtrip = convertReaderLayoutToTransform(
      contentSize,
      transform.scale,
      wrapperWidth,
      wrapperHeight,
      layout.scrollLeft,
      layout.scrollTop
    )
    const metrics = computeReaderLayoutMetrics(
      contentSize,
      transform.scale,
      wrapperWidth,
      wrapperHeight,
      transform
    )

    // Then: Y keeps -y === scrollTop, while fit X stays exactly zero.
    expect(metrics.offsetX).toBe(300)
    expect(layout.scrollLeft).toBe(0)
    expect(layout.scrollTop).toBe(125)
    expect(layout.boundedTransform).toEqual({ x: 0, y: -125, scale: 1 })
    expect(roundtrip).toEqual({ x: 0, y: -125, scale: 1 })
    expect(layout.scrollLeft).not.toBe(metrics.offsetX)
  })

  it('roundtrips both overflow axes through native scroll positions', () => {
    // Given: both axes overflow and no centering offsets exist.
    const contentSize = { width: 1200, height: 900 }
    const wrapperWidth = 800
    const wrapperHeight = 600
    const transform = { x: -250, y: -125, scale: 1 }

    // When: conversion goes transform -> native scroll -> reader transform.
    const layout = convertTransformToLayout(
      transform,
      contentSize,
      wrapperWidth,
      wrapperHeight
    )
    const roundtrip = convertReaderLayoutToTransform(
      contentSize,
      transform.scale,
      wrapperWidth,
      wrapperHeight,
      layout.scrollLeft,
      layout.scrollTop
    )

    // Then: both axes preserve the existing scroll === -transform mapping.
    expect(layout.scrollLeft).toBe(250)
    expect(layout.scrollTop).toBe(125)
    expect(layout.boundedTransform).toEqual({ x: -250, y: -125, scale: 1 })
    expect(roundtrip).toEqual({ x: -250, y: -125, scale: 1 })
  })

  it('clamps scroll back to native ranges without encoding fit-axis offsets into transform', () => {
    // Given: only X overflows, and incoming scroll values exceed native ranges.
    const contentSize = { width: 1200, height: 100 }
    const wrapperWidth = 800
    const wrapperHeight = 600

    // When: scroll is converted directly back to reader transform.
    const result = convertReaderLayoutToTransform(
      contentSize,
      1,
      wrapperWidth,
      wrapperHeight,
      999,
      250
    )

    // Then: X clamps to max scroll, while fit Y ignores both scrollTop and offsetY.
    expect(result).toEqual({ x: -400, y: 0, scale: 1 })
  })
})

describe('validateReaderModeZoomDebounceMs', () => {
  it('returns 500 (default) when value is undefined', () => {
    expect(validateReaderModeZoomDebounceMs(undefined)).toBe(500)
  })

  it('returns 0 when value is explicitly 0 (zero debounce = immediate)', () => {
    expect(validateReaderModeZoomDebounceMs(0)).toBe(0)
  })

  it('returns 500 (default) when value is -1 (negative is invalid)', () => {
    expect(validateReaderModeZoomDebounceMs(-1)).toBe(500)
  })

  it('returns 500 (default) when value is Infinity', () => {
    expect(validateReaderModeZoomDebounceMs(Infinity)).toBe(500)
  })

  it('returns 500 (default) when value is NaN', () => {
    expect(validateReaderModeZoomDebounceMs(NaN)).toBe(500)
  })

  it('returns the value itself when it is a valid positive number', () => {
    expect(validateReaderModeZoomDebounceMs(300)).toBe(300)
  })
})

describe('projectContainTransform', () => {
  // Case 1: smaller on both axes → centers both axes
  it('centers container (200x100) inside wrapper (800x600) at scale=1', () => {
    const result = projectContainTransform(
      { x: -999, y: 999, scale: 1 },
      { width: 200, height: 100 },
      800,
      600
    )
    expect(result).toEqual({ x: 300, y: 250, scale: 1 })
  })

  // Case 2: equal width/height → returns 0 on equal axis
  it('returns x=0, y=0 when container equals wrapper (800x600)', () => {
    const result = projectContainTransform(
      { x: 100, y: -50, scale: 1 },
      { width: 800, height: 600 },
      800,
      600
    )
    expect(result).toEqual({ x: 0, y: 0, scale: 1 })
  })

  // Case 3: larger on both axes → clamps lower bound and upper bound
  it('clamps container (1200x900) overflow in wrapper (800x600) at scale=1', () => {
    const result = projectContainTransform(
      { x: -999, y: 999, scale: 1 },
      { width: 1200, height: 900 },
      800,
      600
    )
    expect(result).toEqual({ x: -400, y: 0, scale: 1 })
  })

  // Case 4: mixed axis smaller-X / larger-Y → centers X, clamps Y
  it('centers X (400x900 in 800x600) and clamps Y to 0', () => {
    const result = projectContainTransform(
      { x: -999, y: 999, scale: 1 },
      { width: 400, height: 900 },
      800,
      600
    )
    expect(result.x).toBe(200)
    expect(result.y).toBe(0)
  })

  // Case 5: mixed axis larger-X / smaller-Y → clamps X, centers Y
  it('clamps X (1200x300 in 800x600) and centers Y', () => {
    const result = projectContainTransform(
      { x: -999, y: 999, scale: 1 },
      { width: 1200, height: 300 },
      800,
      600
    )
    expect(result.x).toBe(-400)
    expect(result.y).toBe(150)
  })

  // Case 6: fractional size/scale uses toBeCloseTo and does not round
  it('handles fractional container size and scale without rounding', () => {
    const result = projectContainTransform(
      { x: -50, y: 25, scale: 0.75 },
      { width: 333.33, height: 111.11 },
      800,
      600
    )
    expect(result.x).toBeCloseTo((800 - 333.33 * 0.75) / 2, 5)
    expect(result.y).toBeCloseTo((600 - 111.11 * 0.75) / 2, 5)
    expect(result.scale).toBe(0.75)
  })

  // Case 7: zero/invalid dimensions → returns original offset, never NaN
  it('returns original offset for zero/negative wrapper and container dimensions', () => {
    const transform = { x: -42, y: 99, scale: 1 }
    // wrapperWidth=0 → projectContainAxis returns desiredOffset
    expect(
      projectContainTransform(transform, { width: 100, height: 100 }, 0, 600).x
    ).toBe(-42)
    // containerWidth=-1 → projectContainAxis returns desiredOffset
    expect(
      projectContainTransform(transform, { width: -1, height: 100 }, 800, 600).x
    ).toBe(-42)
    // scale=0 → projectContainAxis returns desiredOffset
    expect(
      projectContainTransform(
        { x: -42, y: 99, scale: 0 },
        { width: 100, height: 100 },
        800,
        600
      ).x
    ).toBe(-42)
    // NaN in wrapperHeight → returns desiredOffset
    expect(
      projectContainTransform(transform, { width: 100, height: 100 }, 800, NaN)
        .y
    ).toBe(99)
    // Infinity in containerWidth → returns desiredOffset
    expect(
      projectContainTransform(
        transform,
        { width: Infinity, height: 100 },
        800,
        600
      ).x
    ).toBe(-42)
    // 全部无效 → 原样返回，不会产生 NaN
    const bad = projectContainTransform(
      { x: 0, y: 0, scale: NaN },
      { width: 0, height: -1 },
      0,
      0
    )
    expect(Number.isNaN(bad.x)).toBe(false)
    expect(Number.isNaN(bad.y)).toBe(false)
  })
})

describe('applyElasticContainResistance', () => {
  it('leaves within-bounds values unchanged while keeping the hard target identical', () => {
    // Given: both axes overflow, but the desired transform is already inside legal contain bounds.
    const desiredTransform = { x: -200, y: -150, scale: 1 }

    // When: elastic resistance is applied during a drag.
    const result = applyElasticContainResistance({
      transform: desiredTransform,
      containerSize: { width: 1200, height: 900 },
      wrapperSize: { width: 800, height: 600 },
      enabled: true
    })

    // Then: in-range values pass through and the settle target stays the hard projection.
    expect(result.elasticTransform).toEqual(desiredTransform)
    expect(result.targetTransform).toEqual(
      projectContainTransform(
        desiredTransform,
        { width: 1200, height: 900 },
        800,
        600
      )
    )
  })

  it('resists beyond-bound offsets on oversized axes during drag', () => {
    // Given: both axes overflow and the desired pan exceeds opposite legal edges.
    const desiredTransform = { x: 100, y: -500, scale: 1 }

    // When: the helper applies deterministic 0.55 resistance beyond each hard bound.
    const result = applyElasticContainResistance({
      transform: desiredTransform,
      containerSize: { width: 1200, height: 900 },
      wrapperSize: { width: 800, height: 600 },
      enabled: true
    })

    // Then: x is pulled toward upper bound 0, y toward lower bound -300.
    expect(result.elasticTransform.x).toBeCloseTo(55)
    expect(result.elasticTransform.y).toBe(-410)
    expect(result.elasticTransform.scale).toBe(1)
    expect(result.targetTransform).toEqual({ x: 0, y: -300, scale: 1 })
  })

  it('uses projectContainTransform as the disabled and final hard-clamp baseline', () => {
    // Given: a desired transform outside the contain bounds.
    const desiredTransform = { x: 120, y: -999, scale: 1 }
    const hardProjection = projectContainTransform(
      desiredTransform,
      { width: 1200, height: 900 },
      800,
      600
    )

    // When: elasticity is disabled.
    const result = applyElasticContainResistance({
      transform: desiredTransform,
      containerSize: { width: 1200, height: 900 },
      wrapperSize: { width: 800, height: 600 },
      enabled: false
    })

    // Then: both drag value and settle target equal the existing hard projection.
    expect(result.elasticTransform).toEqual(hardProjection)
    expect(result.targetTransform).toEqual(hardProjection)
  })

  it('keeps fitted axes centered without rubber-band drift', () => {
    // Given: the scaled content fits inside the wrapper on both axes.
    const desiredTransform = { x: -999, y: 999, scale: 1 }

    // When: elasticity is enabled for a fitted contain projection.
    const result = applyElasticContainResistance({
      transform: desiredTransform,
      containerSize: { width: 200, height: 100 },
      wrapperSize: { width: 800, height: 600 },
      enabled: true
    })

    // Then: fitted axes remain at their center target and never encode drag offset.
    expect(result.elasticTransform).toEqual({ x: 300, y: 250, scale: 1 })
    expect(result.targetTransform).toEqual({ x: 300, y: 250, scale: 1 })
  })

  it('returns finite stable values when dimensions are invalid', () => {
    // Given: invalid dimensions that projectContainTransform intentionally treats as pass-through.
    const desiredTransform = { x: -42, y: 99, scale: 1 }

    // When: elastic resistance receives non-positive and non-finite geometry.
    const result = applyElasticContainResistance({
      transform: desiredTransform,
      containerSize: { width: Number.POSITIVE_INFINITY, height: -1 },
      wrapperSize: { width: 0, height: Number.NaN },
      enabled: true
    })

    // Then: it preserves the hard-projection baseline and does not manufacture NaN.
    expect(result.elasticTransform).toEqual(desiredTransform)
    expect(result.targetTransform).toEqual(desiredTransform)
    expect(Number.isNaN(result.elasticTransform.x)).toBe(false)
    expect(Number.isNaN(result.elasticTransform.y)).toBe(false)
  })
})
