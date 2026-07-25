import '@testing-library/jest-dom/vitest'
// allow: SIZE_OK — Existing reader-mode regression suite intentionally keeps R1–R14, layout, and scroll-sync matrices together; splitting tests is outside this verification-only Todo.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VirtualPaper } from './VirtualPaper'
import {
  computeReaderLayoutMetrics,
  convertTransformToLayout
} from './transform'
import { VirtualPaperInteractionMode } from './types'
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
  const wrapperSize = { width: 500, height: 500 } as const
  const readerScrollSyncCases = [
    {
      label: 'both axes fit',
      contentSize: { width: 200, height: 100 },
      transform: { x: -120, y: -80, scale: 1 },
      manualScroll: { left: 0, top: 0 }
    },
    {
      label: 'X overflow / Y fit',
      contentSize: { width: 1000, height: 100 },
      transform: { x: -200, y: -80, scale: 1 },
      manualScroll: { left: 240, top: 0 }
    },
    {
      label: 'X fit / Y overflow',
      contentSize: { width: 200, height: 1000 },
      transform: { x: -120, y: -260, scale: 1 },
      manualScroll: { left: 0, top: 260 }
    },
    {
      label: 'both axes overflow',
      contentSize: { width: 1000, height: 2000 },
      transform: { x: -300, y: -400, scale: 1 },
      manualScroll: { left: 280, top: 420 }
    }
  ] as const
  let scrollStore = new WeakMap<
    HTMLElement,
    { scrollLeft: number; scrollTop: number }
  >()

  const getScroll = (el: HTMLElement) => {
    const current = scrollStore.get(el)
    if (current) return current
    const next = { scrollLeft: 0, scrollTop: 0 }
    scrollStore.set(el, next)
    return next
  }

  const expectReaderAxisSync = (
    actualScroll: number,
    expectedTransformOffset: number,
    maxScroll: number
  ) => {
    if (maxScroll === 0) {
      expect(actualScroll).toBe(0)
      expect(actualScroll).not.toBeGreaterThan(0)
      expect(expectedTransformOffset).toBe(0)
      return
    }

    expect(actualScroll).toBeCloseTo(-expectedTransformOffset, 5)
    expect(expectedTransformOffset).toBeLessThanOrEqual(0)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    scrollStore = new WeakMap<
      HTMLElement,
      { scrollLeft: number; scrollTop: number }
    >()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )

    const sizeMap: Record<
      string,
      Record<(typeof propsToStub)[number], number>
    > = {
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

  it('R1b: container allows native touch pan in readerMode', () => {
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
    expect(container.style.touchAction).toBe('pan-x pan-y')
  })

  it('R1c: reader native touch pan cannot be disabled by container styles', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        containerStyle={{ touchAction: 'none' }}
        containerProps={{ style: { touchAction: 'none' } }}
      >
        <div>child</div>
      </VirtualPaper>
    )

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.touchAction).toBe('pan-x pan-y')
  })

  // R2: container uses document flow (no position:absolute, no CSS transform/flex/grid)
  it('R2: container uses document flow with no CSS transform/flex/grid in readerMode', () => {
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
    expect(container.style.position).toBe('relative')
    expect(container.style.position).not.toBe('absolute')
    expect(container.style.transform).toBe('')
    expect(container.style.display).not.toBe('flex')
    expect(container.style.display).not.toBe('grid')
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
    expect(onTransformChange).not.toHaveBeenCalled()
    wrapper.dispatchEvent(new Event('scrollend', { bubbles: true }))
    expect(onTransformChange).toHaveBeenCalledWith(
      expect.objectContaining({ x: -300, y: -700 }),
      expect.objectContaining({ source: 'TrackpadScrollPan' })
    )
  })

  it('R7b: native momentum scroll keeps fractional positions without a transform echo write', () => {
    render(
      <VirtualPaper
        readerMode
        defaultTransform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')

    // Given: 浏览器惯性滚动推进到亚像素位置。
    wrapper.scrollLeft = 120.25
    wrapper.scrollTop = 340.75

    // When: 原生 scroll 同步回内部 transform。
    act(() => {
      wrapper.dispatchEvent(new Event('scroll', { bubbles: true }))
      wrapper.dispatchEvent(new Event('scrollend', { bubbles: true }))
    })

    // Then: React 布局同步不能把原生位置取整后写回，否则会中断动量滚动。
    expect(wrapper.scrollLeft).toBe(120.25)
    expect(wrapper.scrollTop).toBe(340.75)
  })

  it('R7c: pending native scroll survives a parent callback identity change', () => {
    const firstCallback = vi.fn()
    const latestCallback = vi.fn()
    const { rerender } = render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        onTransformChange={firstCallback}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')

    // Given: 原生滚动已经产生待提交姿态，但浏览器尚未发出 scrollend。
    wrapper.scrollLeft = 120
    wrapper.scrollTop = 340
    fireEvent.scroll(wrapper)

    // When: 父组件重渲染并传入新的回调 identity。
    rerender(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        onTransformChange={latestCallback}
      >
        <div>child</div>
      </VirtualPaper>
    )
    wrapper.dispatchEvent(new Event('scrollend', { bubbles: true }))

    // Then: 待提交姿态不会随 effect 重启丢失，并交给最新回调一次。
    expect(firstCallback).not.toHaveBeenCalled()
    expect(latestCallback).toHaveBeenCalledTimes(1)
    expect(latestCallback).toHaveBeenCalledWith(
      expect.objectContaining({ x: -120, y: -340, scale: 1 }),
      expect.objectContaining({ source: 'TrackpadScrollPan' })
    )
  })

  it('R7d: quiet-period fallback commits when scrollend is exposed but never emitted', () => {
    vi.useFakeTimers()
    const originalScrollEnd = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'onscrollend'
    )
    Object.defineProperty(HTMLElement.prototype, 'onscrollend', {
      configurable: true,
      value: null
    })

    try {
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

      // Given: 运行时暴露 scrollend 属性，但实际没有派发该事件。
      wrapper.scrollLeft = 80
      wrapper.scrollTop = 260
      fireEvent.scroll(wrapper)
      expect(onTransformChange).not.toHaveBeenCalled()

      // When: 原生滚动事件安静超过 fallback 窗口。
      act(() => vi.advanceTimersByTime(120))

      // Then: 最终姿态仍会提交，不能无限停留在命令式 ref 中。
      expect(onTransformChange).toHaveBeenCalledTimes(1)
      expect(onTransformChange).toHaveBeenCalledWith(
        expect.objectContaining({ x: -80, y: -260, scale: 1 }),
        expect.objectContaining({ source: 'TrackpadScrollPan' })
      )
    } finally {
      vi.useRealTimers()
      if (originalScrollEnd) {
        Object.defineProperty(
          HTMLElement.prototype,
          'onscrollend',
          originalScrollEnd
        )
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'onscrollend')
      }
    }
  })

  it('R7e: a reader zoom supersedes an older pending native scroll commit', () => {
    vi.useFakeTimers()
    try {
      const onTransformChange = vi.fn()
      const onTransformChangeEnd = vi.fn()
      render(
        <VirtualPaper
          readerMode
          defaultTransform={{ x: 0, y: 0, scale: 1 }}
          contentSize={{ width: 1000, height: 2000 }}
          onTransformChange={onTransformChange}
          onTransformChangeEnd={onTransformChangeEnd}
        >
          <div>child</div>
        </VirtualPaper>
      )
      const wrapper = screen.getByTestId('virtual-paper-wrapper')
      const wheelCalls = vi.mocked(useWheelInteractions).mock.calls
      const wheelArgs = wheelCalls[wheelCalls.length - 1][0]
      const zoomTarget = { x: -240, y: -520, scale: 2 }
      onTransformChange.mockClear()

      // Given: 单指滚动留下尚未提交的 scale=1 姿态。
      wrapper.scrollLeft = 120
      wrapper.scrollTop = 340
      fireEvent.scroll(wrapper)

      // When: 新的阅读缩放预览与提交先完成，旧 scrollend 随后才到达。
      act(() => {
        wheelArgs.previewReaderZoom?.(
          { transform: zoomTarget, origin: { x: 100, y: 120 } },
          {
            source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
            inputType: 'wheel',
            phase: 'change'
          }
        )
        wheelArgs.endTransform(zoomTarget, {
          source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
          inputType: 'wheel',
          phase: 'end'
        })
      })
      wrapper.dispatchEvent(new Event('scrollend', { bubbles: true }))
      act(() => vi.advanceTimersByTime(120))

      // Then: 旧滚动提交已失效，最终姿态仍是新的缩放结果。
      expect(onTransformChange).toHaveBeenLastCalledWith(
        zoomTarget,
        expect.objectContaining({ source: 'MouseWheelCtrlZoom' })
      )
      expect(onTransformChangeEnd).toHaveBeenLastCalledWith(
        zoomTarget,
        expect.objectContaining({ source: 'MouseWheelCtrlZoom' })
      )
      expect(screen.getByTestId('virtual-paper-container').style.width).toBe(
        '2000px'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('R7f: a newer controlled transform supersedes pending native scroll', () => {
    vi.useFakeTimers()
    try {
      const onTransformChange = vi.fn()
      const initialTransform = { x: 0, y: 0, scale: 1 }
      const externalTransform = { x: -40, y: -90, scale: 2 }
      const { rerender } = render(
        <VirtualPaper
          readerMode
          transform={initialTransform}
          contentSize={{ width: 1000, height: 2000 }}
          onTransformChange={onTransformChange}
        >
          <div>child</div>
        </VirtualPaper>
      )
      const wrapper = screen.getByTestId('virtual-paper-wrapper')

      // Given: 受控阅读器存在尚未提交的原生滚动姿态。
      wrapper.scrollLeft = 120
      wrapper.scrollTop = 340
      fireEvent.scroll(wrapper)

      // When: 父组件先发布一个数值不同的新受控姿态。
      rerender(
        <VirtualPaper
          readerMode
          transform={externalTransform}
          contentSize={{ width: 1000, height: 2000 }}
          onTransformChange={onTransformChange}
        >
          <div>child</div>
        </VirtualPaper>
      )
      wrapper.dispatchEvent(new Event('scrollend', { bubbles: true }))
      act(() => vi.advanceTimersByTime(120))

      // Then: 晚到的旧滚动提交不能覆盖新的受控姿态。
      expect(onTransformChange).not.toHaveBeenCalled()
      expect(wrapper.scrollLeft).toBe(40)
      expect(wrapper.scrollTop).toBe(90)
    } finally {
      vi.useRealTimers()
    }
  })

  it('R7g: leaving readerMode commits the latest pending native scroll', () => {
    const onTransformChange = vi.fn()
    const { rerender } = render(
      <VirtualPaper
        readerMode
        defaultTransform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')

    // Given: 模式切换前，原生滚动的最终姿态仍在等待 scrollend。
    wrapper.scrollLeft = 120
    wrapper.scrollTop = 340
    fireEvent.scroll(wrapper)

    // When: 调用方立即退出 readerMode。
    rerender(
      <VirtualPaper
        defaultTransform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )

    // Then: 普通模式继承最后滚动坐标，不回退到切换前的旧姿态。
    expect(onTransformChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: -120, y: -340, scale: 1 }),
      expect.objectContaining({ source: 'TrackpadScrollPan' })
    )
    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(-120px, -340px, 0) scale(1)'
    )
  })

  it('R7h: becoming controlled supersedes pending native scroll', () => {
    vi.useFakeTimers()
    try {
      const onTransformChange = vi.fn()
      const externalTransform = { x: -40, y: -90, scale: 2 }
      const { rerender } = render(
        <VirtualPaper
          readerMode
          defaultTransform={{ x: 0, y: 0, scale: 1 }}
          contentSize={{ width: 1000, height: 2000 }}
          onTransformChange={onTransformChange}
        >
          <div>child</div>
        </VirtualPaper>
      )
      const wrapper = screen.getByTestId('virtual-paper-wrapper')
      onTransformChange.mockClear()

      // Given: 非受控阅读器仍有一笔等待提交的原生滚动。
      wrapper.scrollLeft = 120
      wrapper.scrollTop = 340
      fireEvent.scroll(wrapper)

      // When: 调用方在 scrollend 前接管 transform。
      rerender(
        <VirtualPaper
          readerMode
          transform={externalTransform}
          contentSize={{ width: 1000, height: 2000 }}
          onTransformChange={onTransformChange}
        >
          <div>child</div>
        </VirtualPaper>
      )
      wrapper.dispatchEvent(new Event('scrollend', { bubbles: true }))
      act(() => vi.advanceTimersByTime(120))

      // Then: 首个受控姿态立即成为唯一权威值。
      expect(onTransformChange).not.toHaveBeenCalled()
      expect(wrapper.scrollLeft).toBe(40)
      expect(wrapper.scrollTop).toBe(90)
    } finally {
      vi.useRealTimers()
    }
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
    expect(container.style.transform).toBe(
      'translate3d(-100px, -50px, 0) scale(1)'
    )
  })

  // R10: missing contentSize falls back safely without crashing
  it('R10: missing contentSize falls back to wrapper size without crashing', () => {
    expect(() => {
      render(
        <VirtualPaper readerMode transform={{ x: 0, y: 0, scale: 1 }}>
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
    expect(onTransformChange).not.toHaveBeenCalled()
    wrapper.dispatchEvent(new Event('scrollend', { bubbles: true }))
    expect(onTransformChange).toHaveBeenCalledWith(
      expect.objectContaining({ x: -300, y: -700 }),
      expect.objectContaining({ source: 'TrackpadScrollPan' })
    )
  })

  it('R15: edgeElasticScroll in readerMode keeps native scroll layout with no rubber-band transform', () => {
    render(
      <VirtualPaper
        containMode
        edgeElasticScroll
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )

    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')
    const wheelCalls = vi.mocked(useWheelInteractions).mock.calls
    const lastWheelArgs = wheelCalls[wheelCalls.length - 1][0]

    expect(lastWheelArgs.isReaderMode).toBe(true)
    expect(lastWheelArgs.containMode).toBe(false)
    expect(lastWheelArgs.edgeElasticScroll).toBe(true)
    expect(wrapper.style.overflow).toBe('auto')
    expect(container.style.position).toBe('relative')
    expect(container.style.transform).toBe('')
  })

  // ---- Axis-combination layout tests (Todo 3) ----

  // L1: both axes fit → marginLeft > 0, marginTop > 0, no scroll
  it('L1: both axes fit → marginLeft > 0, marginTop > 0, width/height scaled, no scroll', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 200, height: 100 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')
    // wrapper 500x500, content 200x100 -> offsetX = (500-200)/2 = 150, offsetY = (500-100)/2 = 200
    expect(container.style.marginLeft).toBe('150px')
    expect(container.style.marginTop).toBe('200px')
    expect(container.style.width).toBe('200px')
    expect(container.style.height).toBe('100px')
    expect(wrapper.scrollLeft).toBe(0)
    expect(wrapper.scrollTop).toBe(0)
    // style restrictions
    expect(container.style.position).toBe('relative')
    expect(container.style.transform).toBe('')
    expect(container.style.display).not.toBe('flex')
    expect(container.style.display).not.toBe('grid')
  })

  // L2: X overflows / Y fits → marginLeft = 0, marginTop > 0, scrollLeft > 0, scrollTop = 0
  it('L2: X overflow / Y fit → marginLeft = 0, marginTop > 0, scrollLeft > 0, scrollTop = 0', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: -200, y: 0, scale: 1 }}
        contentSize={{ width: 1000, height: 100 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')
    // wrapper 500x500, content 1000x100 -> offsetX = max((500-1000)/2,0)=0, offsetY=(500-100)/2=200
    expect(container.style.marginLeft).toBe('0px')
    expect(container.style.marginTop).toBe('200px')
    expect(container.style.width).toBe('1000px')
    expect(container.style.height).toBe('100px')
    expect(wrapper.scrollLeft).toBe(200)
    expect(wrapper.scrollTop).toBe(0)
    expect(container.style.position).toBe('relative')
    expect(container.style.transform).toBe('')
    expect(container.style.display).not.toBe('flex')
    expect(container.style.display).not.toBe('grid')
  })

  // L3: X fits / Y overflows → marginLeft > 0, marginTop = 0, scrollLeft = 0, scrollTop > 0
  it('L3: X fit / Y overflow → marginLeft > 0, marginTop = 0, scrollLeft = 0, scrollTop > 0', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: 0, y: -200, scale: 1 }}
        contentSize={{ width: 200, height: 1000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')
    // wrapper 500x500, content 200x1000 -> offsetX=(500-200)/2=150, offsetY=max((500-1000)/2,0)=0
    expect(container.style.marginLeft).toBe('150px')
    expect(container.style.marginTop).toBe('0px')
    expect(container.style.width).toBe('200px')
    expect(container.style.height).toBe('1000px')
    expect(wrapper.scrollLeft).toBe(0)
    expect(wrapper.scrollTop).toBe(200)
    expect(container.style.position).toBe('relative')
    expect(container.style.transform).toBe('')
    expect(container.style.display).not.toBe('flex')
    expect(container.style.display).not.toBe('grid')
  })

  // L4: both axes overflow → marginLeft = 0, marginTop = 0, scroll mirrors negative transform
  it('L4: both axes overflow → marginLeft = 0, marginTop = 0, scroll mirrors negative transform', () => {
    render(
      <VirtualPaper
        readerMode
        transform={{ x: -300, y: -400, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.marginLeft).toBe('0px')
    expect(container.style.marginTop).toBe('0px')
    expect(container.style.width).toBe('1000px')
    expect(container.style.height).toBe('2000px')
    expect(wrapper.scrollLeft).toBe(300)
    expect(wrapper.scrollTop).toBe(400)
    expect(container.style.position).toBe('relative')
    expect(container.style.transform).toBe('')
    expect(container.style.display).not.toBe('flex')
    expect(container.style.display).not.toBe('grid')
  })

  it.each(readerScrollSyncCases)(
    'S1: transform → native scroll sync keeps centered fit axes at zero ($label)',
    ({ contentSize, transform }) => {
      render(
        <VirtualPaper
          readerMode
          transform={transform}
          contentSize={contentSize}
        >
          <div>child</div>
        </VirtualPaper>
      )

      const wrapper = screen.getByTestId('virtual-paper-wrapper')
      const metrics = computeReaderLayoutMetrics(
        contentSize,
        transform.scale,
        wrapperSize.width,
        wrapperSize.height,
        transform
      )
      const layout = convertTransformToLayout(
        transform,
        contentSize,
        wrapperSize.width,
        wrapperSize.height
      )

      expect(wrapper.scrollLeft).toBeCloseTo(Math.max(0, layout.scrollLeft), 5)
      expect(wrapper.scrollTop).toBeCloseTo(Math.max(0, layout.scrollTop), 5)
      expectReaderAxisSync(
        wrapper.scrollLeft,
        metrics.boundedTransform.x,
        metrics.maxScrollLeft
      )
      expectReaderAxisSync(
        wrapper.scrollTop,
        metrics.boundedTransform.y,
        metrics.maxScrollTop
      )
    }
  )

  it.each(readerScrollSyncCases)(
    'S2: native scroll → transform sync ignores fit axes ($label)',
    ({ contentSize, manualScroll }) => {
      const onTransformChange = vi.fn()
      render(
        <VirtualPaper
          readerMode
          transform={{ x: 0, y: 0, scale: 1 }}
          contentSize={contentSize}
          onTransformChange={onTransformChange}
        >
          <div>child</div>
        </VirtualPaper>
      )

      const wrapper = screen.getByTestId('virtual-paper-wrapper')
      act(() => {
        wrapper.scrollLeft = manualScroll.left
        wrapper.scrollTop = manualScroll.top
        fireEvent.scroll(wrapper)
        wrapper.dispatchEvent(new Event('scrollend', { bubbles: true }))
      })

      const metrics = computeReaderLayoutMetrics(
        contentSize,
        1,
        wrapperSize.width,
        wrapperSize.height,
        { x: -manualScroll.left, y: -manualScroll.top, scale: 1 }
      )
      const expectedTransform = metrics.boundedTransform

      expectReaderAxisSync(
        wrapper.scrollLeft,
        expectedTransform.x,
        metrics.maxScrollLeft
      )
      expectReaderAxisSync(
        wrapper.scrollTop,
        expectedTransform.y,
        metrics.maxScrollTop
      )

      if (expectedTransform.x === 0 && expectedTransform.y === 0) {
        expect(onTransformChange).not.toHaveBeenCalled()
        return
      }

      expect(onTransformChange).toHaveBeenCalledWith(
        expect.objectContaining({
          x: expectedTransform.x,
          y: expectedTransform.y,
          scale: expectedTransform.scale
        }),
        expect.objectContaining({ source: 'TrackpadScrollPan' })
      )
    }
  )

  // F2: sub-pixel scroll echo within tolerance does NOT update transform
  it('F2: scroll echo within READER_PROGRAMMATIC_SCROLL_TOLERANCE_PX skips transform update', () => {
    const onTransformChange = vi.fn()
    render(
      <VirtualPaper
        readerMode
        transform={{ x: -200, y: -500, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')

    // After render, the useLayoutEffect syncs transform→scroll and sets
    // programmaticReaderScrollRef to the target (scrollLeft=200, scrollTop=500).
    // Simulate browser sub-pixel rounding: shift by +0.5px (within 1px tolerance).
    wrapper.scrollLeft = 200.5
    wrapper.scrollTop = 500.5
    fireEvent.scroll(wrapper)

    // The scroll handler should recognize this as a programmatic echo
    // and skip the transform update entirely.
    expect(onTransformChange).not.toHaveBeenCalled()
  })

  it('Z1: reader zoom previews with anchored CSS transform and commits layout only on end', () => {
    const onTransformChange = vi.fn()
    const onTransformChangeEnd = vi.fn()
    render(
      <VirtualPaper
        readerMode
        defaultTransform={{ x: -200, y: -300, scale: 1 }}
        contentSize={{ width: 1000, height: 2000 }}
        onTransformChange={onTransformChange}
        onTransformChangeEnd={onTransformChangeEnd}
      >
        <div>child</div>
      </VirtualPaper>
    )

    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')
    const wheelCalls = vi.mocked(useWheelInteractions).mock.calls
    const wheelArgs = wheelCalls[wheelCalls.length - 1][0]
    const previewReaderZoom = Reflect.get(wheelArgs, 'previewReaderZoom')
    const target = { x: -350, y: -650, scale: 2 }

    expect(previewReaderZoom).toBeTypeOf('function')
    if (typeof previewReaderZoom !== 'function') return

    act(() => {
      previewReaderZoom(
        { transform: target, origin: { x: 125, y: 150 } },
        {
          source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
          inputType: 'wheel',
          phase: 'change'
        }
      )
    })

    expect(container.style.width).toBe('1000px')
    expect(container.style.height).toBe('2000px')
    expect(wrapper.scrollLeft).toBe(200)
    expect(wrapper.scrollTop).toBe(300)
    expect(container.style.transformOrigin).toBe('325px 450px')
    expect(container.style.transform).toBe(
      'translate3d(175px, 100px, 0) scale(2)'
    )
    expect(onTransformChange).toHaveBeenLastCalledWith(
      target,
      expect.objectContaining({ phase: 'change' })
    )

    act(() => {
      wheelArgs.endTransform(target, {
        source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
        inputType: 'wheel',
        phase: 'end'
      })
    })

    expect(container.style.width).toBe('2000px')
    expect(container.style.height).toBe('4000px')
    expect(wrapper.scrollLeft).toBe(350)
    expect(wrapper.scrollTop).toBe(650)
    expect(container.style.transform).toBe('')
    expect(onTransformChangeEnd).toHaveBeenLastCalledWith(
      target,
      expect.objectContaining({ phase: 'end' })
    )
  })
})
