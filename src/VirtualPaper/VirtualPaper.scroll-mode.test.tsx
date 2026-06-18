import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { VirtualPaper } from './VirtualPaper'
import { VirtualPaperRenderMode } from './types'
import { useMultiDragInteractions } from './useMultiDragInteractions'
import { useWheelInteractions } from './useWheelInteractions'

vi.mock('./useMultiDragInteractions', () => ({
  useMultiDragInteractions: vi.fn()
}))
vi.mock('./useWheelInteractions', () => ({
  useWheelInteractions: vi.fn()
}))

// scroll 模式测试需要 stub jsdom 不提供的布局/滚动属性：
// - ResizeObserver：jsdom 不内置，stub 为空实现
// - clientWidth/clientHeight：wrapper 视口尺寸（mock 为 800x600）
// - offsetWidth/offsetHeight：container 基础内容尺寸（mock 为 400x300）
// - scrollLeft/scrollTop：用 WeakMap 做 per-element 可读写存储
describe('VirtualPaper scroll render mode', () => {
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
    // 用 class（非箭头函数）保证可被 `new ResizeObserver(...)` 构造
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const sizeMap: Record<string, Record<(typeof propsToStub)[number], number>> = {
      'virtual-paper-wrapper': {
        clientWidth: 800,
        clientHeight: 600,
        offsetWidth: 800,
        offsetHeight: 600
      },
      'virtual-paper-container': {
        clientWidth: 400,
        clientHeight: 300,
        offsetWidth: 400,
        offsetHeight: 300
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
  })

  it('S1: wrapper uses overflow:auto for native scrolling in scroll mode', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.style.overflow).toBe('auto')
  })

  it('S2: renders 2-layer structure without scroll-surface/scroll-box in scroll mode', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    // 无 scroll-surface / scroll-box 中间层
    expect(screen.queryByTestId('virtual-paper-scroll-surface')).not.toBeInTheDocument()
    expect(screen.queryByTestId('virtual-paper-scroll-box')).not.toBeInTheDocument()
    // wrapper > container > children 2 层结构
    expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('virtual-paper-container')).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()
  })

  it('S3: container width/height scaled by transform.scale, no transform CSS', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 2 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    // scaledW = 400 * 2 = 800, scaledH = 300 * 2 = 600
    expect(container.style.width).toBe('800px')
    expect(container.style.height).toBe('600px')
    // 不使用 transform
    expect(container.style.transform).toBe('')
  })

  it('S4: transform.x/y drives wrapper.scrollLeft/Top (negative transform = positive scroll)', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: -200, y: -100, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    // transform.x = -200 → scrollLeft = 200
    expect(wrapper.scrollLeft).toBe(200)
    expect(wrapper.scrollTop).toBe(100)
  })

  it('S5: positive transform.x clamps scrollLeft to 0 (native scroll cannot represent positive transform)', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 100, y: 50, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    // transform.x = 100 → target scrollLeft = -100 → clamped to 0
    expect(wrapper.scrollLeft).toBe(0)
    expect(wrapper.scrollTop).toBe(0)
  })

  it('S6: container smaller than wrapper → scrollLeft clamped to 0 (no scroll room)', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.scrollLeft).toBe(0)
    expect(wrapper.scrollTop).toBe(0)
  })

  it('S7: controlled transform change updates wrapper.scrollLeft/Top', () => {
    const { rerender } = render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    let wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.scrollLeft).toBe(0)

    rerender(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: -300, y: -200, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.scrollLeft).toBe(300)
    expect(wrapper.scrollTop).toBe(200)
  })

  it('S8: mode switch transform->scroll->transform preserves transform state', () => {
    const { rerender } = render(
      <VirtualPaper transform={{ x: -100, y: -50, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    let container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe('translate3d(-100px, -50px, 0) scale(1)')

    // 切换到 scroll 模式
    rerender(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: -100, y: -50, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    container = screen.getByTestId('virtual-paper-container')
    // scroll 模式无 transform
    expect(container.style.transform).toBe('')
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    // transform.x=-100 → scrollLeft=100
    expect(wrapper.scrollLeft).toBe(100)

    // 切回 transform 模式
    rerender(
      <VirtualPaper transform={{ x: -100, y: -50, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe('translate3d(-100px, -50px, 0) scale(1)')
  })

  it('S9: contentSize prop determines base size for container width/height', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 2 }}
        contentSize={{ width: 200, height: 150 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    // baseSize=200x150, scale=2 → scaledW=400, scaledH=300
    expect(container.style.width).toBe('400px')
    expect(container.style.height).toBe('300px')
  })

  it('S10: containerStyle and containerClassName apply to container in scroll mode', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
        containerClassName="user-container"
        containerStyle={{ backgroundColor: 'red' }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.className).toContain('user-container')
    expect(container.style.backgroundColor).toBe('red')
  })

  it('S11: scroll mode wires gesture hooks with containerRef pointing to container', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    expect(useMultiDragInteractions).toHaveBeenCalled()
    expect(useWheelInteractions).toHaveBeenCalled()
    const calls = vi.mocked(useMultiDragInteractions).mock.calls
    const args = calls[calls.length - 1][0]
    expect(args.containerRef.current).not.toBeNull()
    // containerRef 直接指向 container（不再是 scroll-box 中间层）
    expect(args.containerRef.current?.getAttribute('data-testid')).toBe(
      'virtual-paper-container'
    )
  })

  it('S12: default renderMode is Transform (regression: no scroll mode behavior)', () => {
    render(
      <VirtualPaper transform={{ x: 0, y: 0, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    expect(
      screen.queryByTestId('virtual-paper-scroll-surface')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('virtual-paper-scroll-box')
    ).not.toBeInTheDocument()
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toContain('translate3d')
  })
})
