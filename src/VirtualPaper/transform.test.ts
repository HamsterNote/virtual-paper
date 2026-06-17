import { describe, expect, it } from 'vitest'

import {
  applyZoomAnchor,
  clampScale,
  getInitialTransform,
  mergeDefaultTransform,
  serializeTransform
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
