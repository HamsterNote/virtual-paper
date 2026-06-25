import { describe, expect, it, vi } from 'vitest'
import {
  measureContainBox,
  projectContainTransformForElements
} from './containMode'

// ---- DOM mock helpers ----

function createMockElement(
  overrides: {
    clientWidth?: number
    clientHeight?: number
    offsetWidth?: number
    offsetHeight?: number
    rect?: { width: number; height: number }
  } = {}
): HTMLElement {
  const el = document.createElement('div')
  const {
    clientWidth = 0,
    clientHeight = 0,
    offsetWidth = 0,
    offsetHeight = 0,
    rect = { width: 0, height: 0 }
  } = overrides

  Object.defineProperty(el, 'clientWidth', {
    value: clientWidth,
    configurable: true
  })
  Object.defineProperty(el, 'clientHeight', {
    value: clientHeight,
    configurable: true
  })
  Object.defineProperty(el, 'offsetWidth', {
    value: offsetWidth,
    configurable: true
  })
  Object.defineProperty(el, 'offsetHeight', {
    value: offsetHeight,
    configurable: true
  })
  el.getBoundingClientRect = vi.fn(() => ({
    width: rect.width,
    height: rect.height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: rect.width,
    bottom: rect.height,
    toJSON: () => {}
  }))

  return el
}

describe('measureContainBox', () => {
  it('returns valid dimensions when wrapper and container have positive sizes', () => {
    const wrapper = createMockElement({ clientWidth: 800, clientHeight: 600 })
    const container = createMockElement({ offsetWidth: 400, offsetHeight: 300 })

    const result = measureContainBox(wrapper, container, 1)
    expect(result).toEqual({
      wrapperWidth: 800,
      wrapperHeight: 600,
      containerWidth: 400,
      containerHeight: 300
    })
  })

  it('returns null when wrapper clientWidth is 0 and getBoundingClientRect fallback is also 0', () => {
    const wrapper = createMockElement({
      clientWidth: 0,
      clientHeight: 0,
      rect: { width: 0, height: 0 }
    })
    const container = createMockElement({ offsetWidth: 400, offsetHeight: 300 })

    expect(measureContainBox(wrapper, container, 1)).toBeNull()
  })

  it('returns null when container offsetWidth is 0 and rect fallback is also 0', () => {
    const wrapper = createMockElement({ clientWidth: 800, clientHeight: 600 })
    const container = createMockElement({
      offsetWidth: 0,
      offsetHeight: 0,
      rect: { width: 0, height: 0 }
    })

    expect(measureContainBox(wrapper, container, 1)).toBeNull()
  })

  it('returns null when all measurements produce NaN', () => {
    const wrapper = createMockElement()
    const container = createMockElement()
    // getBoundingClientRect returns 0 for both, so clientWidth=0 → rect=0 → null
    expect(measureContainBox(wrapper, container, 1)).toBeNull()
  })

  it('returns null instead of amplifying rect fallback when scale is too small', () => {
    const wrapper = createMockElement({ clientWidth: 800, clientHeight: 600 })
    const container = createMockElement({
      offsetWidth: 0,
      offsetHeight: 0,
      rect: { width: 100, height: 80 }
    })

    expect(measureContainBox(wrapper, container, 0.001)).toBeNull()
  })
})

describe('projectContainTransformForElements', () => {
  it('projects to center when container is smaller than wrapper', () => {
    const wrapper = createMockElement({ clientWidth: 800, clientHeight: 600 })
    const container = createMockElement({ offsetWidth: 200, offsetHeight: 100 })

    const result = projectContainTransformForElements(
      { x: -999, y: 999, scale: 1 },
      wrapper,
      container
    )
    expect(result).toEqual({ x: 300, y: 250, scale: 1 })
  })

  it('returns original transform when measurement fails (zero wrapper)', () => {
    const wrapper = createMockElement({
      clientWidth: 0,
      clientHeight: 0,
      rect: { width: 0, height: 0 }
    })
    const container = createMockElement({ offsetWidth: 200, offsetHeight: 100 })
    const transform = { x: -50, y: 75, scale: 1 }

    const result = projectContainTransformForElements(
      transform,
      wrapper,
      container
    )
    expect(result).toEqual(transform)
  })

  it('uses getBoundingClientRect fallback divided by scale when offsetWidth is 0', () => {
    const wrapper = createMockElement({ clientWidth: 800, clientHeight: 600 })
    // offsetWidth=0 → fallback to rect.width / Math.max(scale, 0.000001)
    // rect.width=300, scale=0.5 → containerWidth=600
    const container = createMockElement({
      offsetWidth: 0,
      offsetHeight: 0,
      rect: { width: 300, height: 200 }
    })

    const result = projectContainTransformForElements(
      { x: 0, y: 0, scale: 0.5 },
      wrapper,
      container
    )
    // containerWidth = 300 / 0.5 = 600, containerHeight = 200 / 0.5 = 400
    // x = (800 - 600*0.5)/2 = (800-300)/2 = 250, y = (600 - 400*0.5)/2 = (600-200)/2 = 200
    expect(result.x).toBe(250)
    expect(result.y).toBe(200)
    expect(result.scale).toBe(0.5)
  })
})
