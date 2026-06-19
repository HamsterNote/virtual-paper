import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { VirtualPaper } from './VirtualPaper'
import { useMultiDragInteractions } from './useMultiDragInteractions'
import { useWheelInteractions } from './useWheelInteractions'

vi.mock('./useMultiDragInteractions', () => ({
  useMultiDragInteractions: vi.fn()
}))
vi.mock('./useWheelInteractions', () => ({
  useWheelInteractions: vi.fn()
}))

describe('VirtualPaper readerMode', () => {
  const originals = new Map<string, PropertyDescriptor>()
  const propsToStub = [
    'clientWidth',
    'clientHeight',
    'offsetWidth',
    'offsetHeight'
  ] as const
  const scrollProps = ['scrollLeft', 'scrollTop'] as const
  let scrollStore = new WeakMap<HTMLElement, { scrollLeft: number; scrollTop: number }>()

  const getScroll = (el: HTMLElement) => {
    const current = scrollStore.get(el)
    if (current) return current
    const next = { scrollLeft: 0, scrollTop: 0 }
    scrollStore.set(el, next)
    return next
  }

  beforeEach(() => {
    vi.clearAllMocks()
    scrollStore = new WeakMap<HTMLElement, { scrollLeft: number; scrollTop: number }>()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const sizeMap: Record<string, Record<(typeof propsToStub)[number], number>> = {
      'virtual-paper-wrapper': {
        clientWidth: 500,
        clientHeight: 500,
        offsetWidth: 500,
        offsetHeight: 500
      },
      'virtual-paper-container': {
        clientWidth: 500,
        clientHeight: 500,
        offsetWidth: 500,
        offsetHeight: 500
      }
    }

    for (const prop of propsToStub) {
      const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
      if (desc) originals.set(prop, desc)
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get(this: HTMLElement) {
          const testId = this.getAttribute('data-testid')
          if (testId && testId in sizeMap) return sizeMap[testId][prop]
          return desc?.get?.call(this) ?? 0
        }
      })
    }

    for (const prop of scrollProps) {
      const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
      if (desc) originals.set(prop, desc)
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get(this: HTMLElement) {
          return getScroll(this)[prop]
        },
        set(this: HTMLElement, value: number) {
          getScroll(this)[prop] = value
        }
      })
    }
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    for (const prop of [...propsToStub, ...scrollProps]) {
      const desc = originals.get(prop)
      if (desc) {
        Object.defineProperty(HTMLElement.prototype, prop, desc)
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, prop)
      }
    }
    originals.clear()
    vi.restoreAllMocks()
  })

  // R1: wrapper uses overflow:auto for native scrolling in readerMode
  it('R1: wrapper uses overflow:auto for native scrolling in readerMode', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.style.overflow).toBe('auto')
  })

  // R2: container uses document flow (no position:absolute, no CSS transform)
  it('R2: container uses document flow with no CSS transform in readerMode', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.position).not.toBe('absolute')
    expect(container.style.transform).toBe('')
  })

  // R3: container size = contentSize * scale (scale=1, content 1000x2000)
  it('R3: container width/height equals contentSize * scale (1000x2000 @ scale=1)', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('1000px')
    expect(container.style.height).toBe('2000px')
  })

  // R4: container size = contentSize * scale (scale=2, content 1000x2000 → 2000x4000)
  it('R4: container size scales with transform.scale (1000x2000 @ scale=2 = 2000x4000)', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 2 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('2000px')
    expect(container.style.height).toBe('4000px')
  })

  // R5: container size = contentSize * scale (scale=0.25, content 1000x2000 → 250x500)
  it('R5: container size scales down at scale=0.25 (1000x2000 @ 0.25 = 250x500)', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 0.25 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('250px')
    expect(container.style.height).toBe('500px')
  })

  // R6: transform.x/y drives wrapper.scrollLeft/scrollTop (negative transform → positive scroll)
  it('R6: negative transform drives wrapper scroll position (x=-200, y=-500 → scrollLeft=200, scrollTop=500)', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: -200, y: -500, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.scrollLeft).toBe(200)
    expect(wrapper.scrollTop).toBe(500)
  })

  // R7: native scroll event updates transform to negative scroll values
  it('R7: native scroll syncs transform to negative scrollLeft/scrollTop values', () => {
    const onTransformChange = vi.fn()
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    wrapper.scrollLeft = 300
    wrapper.scrollTop = 700
    wrapper.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(onTransformChange).toHaveBeenCalledWith(
      expect.objectContaining({ x: -300, y: -700 }),
      expect.objectContaining({ source: 'TrackpadScrollPan' })
    )
  })

  // R8: mode toggle false→true maps existing transform to layout + scroll
  it('R8: mode toggle false→true maps CSS transform to document-flow layout + scroll', () => {
    const { rerender } = render(
      <VirtualPaper transform={{ x: -100, y: -50, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toContain('translate3d')

    rerender(
      <VirtualPaper
        readerMode
        transform={{ x: -100, y: -50, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    expect(container.style.transform).toBe('')
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.scrollLeft).toBe(100)
    expect(wrapper.scrollTop).toBe(50)
  })

  // R9: mode toggle true→false maps scroll back to CSS transform
  it('R9: mode toggle true→false restores CSS transform from scroll position', () => {
    const { rerender } = render(
      <VirtualPaper
        readerMode
        transform={{ x: -100, y: -50, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe('')

    rerender(
      <VirtualPaper transform={{ x: -100, y: -50, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    expect(container.style.transform).toBe('translate3d(-100px, -50px, 0) scale(1)')
  })

  // R10: missing contentSize falls back safely without crashing
  it('R10: missing contentSize falls back to wrapper size without crashing', () => {
    expect(() => {
      render(
        <VirtualPaper
          readerMode
          transform={{ x: 0, y: 0, scale: 1 }}
        >
          <div>child</div>
        </VirtualPaper>
      )
    }).not.toThrow()
  })

  // R11: wires gesture hooks with isReaderMode flag in readerMode
  it('R11: passes isReaderMode=true to wheel and drag hooks', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    expect(useWheelInteractions).toHaveBeenCalled()
    expect(useMultiDragInteractions).toHaveBeenCalled()
    const wheelCalls = vi.mocked(useWheelInteractions).mock.calls
    const lastWheelArgs = wheelCalls[wheelCalls.length - 1][0]
    expect(lastWheelArgs.isReaderMode).toBe(true)
  })

  // R12: containMode={true} is ignored in readerMode — wrapper still uses overflow:auto
  it('R12: containMode={true} ignored in readerMode — wrapper still uses overflow:auto', () => {
    render(
      <VirtualPaper
        containMode
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.style.overflow).toBe('auto')
  })

  // R13: containMode={true} in readerMode — container size from convertTransformToLayout
  it('R13: containMode={true} in readerMode — container size from convertTransformToLayout (1000x2000 @ scale=1)', () => {
    render(
      <VirtualPaper
        containMode
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('1000px')
    expect(container.style.height).toBe('2000px')
    expect(container.style.transform).toBe('')
  })

  // R14: containMode={true} in readerMode — scroll sync unchanged (same as R7 baseline)
  it('R14: containMode={true} in readerMode — scroll sync still maps to negative scroll values', () => {
    const onTransformChange = vi.fn()
    render(
      <VirtualPaper
        containMode
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    wrapper.scrollLeft = 300
    wrapper.scrollTop = 700
    wrapper.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(onTransformChange).toHaveBeenCalledWith(
      expect.objectContaining({ x: -300, y: -700 }),
      expect.objectContaining({ source: 'TrackpadScrollPan' })
    )
  })
})
