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

// scroll 模式测试需要 stub jsdom 不提供的布局属性：
// - ResizeObserver：jsdom 不内置，stub 为空实现（初始测量走 useLayoutEffect 同步路径）
// - clientWidth/clientHeight：wrapper 视口尺寸（mock 为 800x600）
// - offsetWidth/offsetHeight：scaler 未缩放测量尺寸（mock 为 400x300）
//
// 几何期望值依据 computeScrollGeometry（scrollGeometry.ts）：
//   originX = max(viewportW, ceil(max(x, 0)))
//   tailX   = max(viewportW, ceil(viewportW - x - scaledW))
//   surfaceWidth = originX + scaledW + tailX
//   scrollLeft = originX - x
describe('VirtualPaper scroll render mode', () => {
  const originals = new Map<string, PropertyDescriptor>()
  const propsToStub = [
    'clientWidth',
    'clientHeight',
    'offsetWidth',
    'offsetHeight'
  ] as const

  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    for (const [prop, desc] of originals) {
      Object.defineProperty(HTMLElement.prototype, prop, desc)
    }
    originals.clear()
  })

  it('S2: renders scroll-surface and scroll-box layers in scroll mode', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    expect(
      screen.getByTestId('virtual-paper-scroll-surface')
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('virtual-paper-scroll-box')
    ).toBeInTheDocument()
    expect(screen.getByTestId('virtual-paper-container')).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()
  })

  it('S2: scroll-surface width/height sized to surface geometry', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const surface = screen.getByTestId('virtual-paper-scroll-surface')
    // originX=800, scaledW=400, tailX=max(800,800-0-400)=800, surfaceW=2000
    expect(surface.style.width).toBe('2000px')
    // originY=600, scaledH=300, tailY=max(600,600-0-300)=600, surfaceH=1500
    expect(surface.style.height).toBe('1500px')
  })

  it('S3: sets wrapper.scrollLeft = originX - x and scrollTop = originY - y', () => {
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
    expect(wrapper.scrollLeft).toBe(700)
    expect(wrapper.scrollTop).toBe(550)
  })

  it('S3: handles negative x (content shifted left of viewport)', () => {
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
    // originX=800, scrollLeft=800-(-200)=1000
    expect(wrapper.scrollLeft).toBe(1000)
    expect(wrapper.scrollTop).toBe(700)
  })

  it('S3: applies scale to surface sizing and scaler transform', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 2 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const scaler = screen.getByTestId('virtual-paper-container')
    expect(scaler.style.transform).toBe('scale(2)')
    const surface = screen.getByTestId('virtual-paper-scroll-surface')
    // scaledW=800, originX=800, tailX=max(800,800-0-800)=800, surfaceW=2400
    expect(surface.style.width).toBe('2400px')
  })

  it('S5: mode switch transform->scroll->transform restores transform rendering', () => {
    const { rerender } = render(
      <VirtualPaper transform={{ x: 100, y: 50, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    let container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe('translate3d(100px, 50px, 0) scale(1)')

    rerender(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 100, y: 50, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe('scale(1)')
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.scrollLeft).toBe(700)

    rerender(
      <VirtualPaper transform={{ x: 100, y: 50, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe('translate3d(100px, 50px, 0) scale(1)')
  })

  it('S6: uses contentSize prop over measured size', () => {
    render(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 0, y: 0, scale: 1 }}
        contentSize={{ width: 200, height: 150 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    // offsetWidth mock 返回 400，但 contentSize={200,150} 应优先
    // scaledW=200, surfaceW=800+200+800=1800
    const surface = screen.getByTestId('virtual-paper-scroll-surface')
    expect(surface.style.width).toBe('1800px')
  })

  it('S7: controlled transform change drives scrollLeft', () => {
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
    expect(wrapper.scrollLeft).toBe(800)

    rerender(
      <VirtualPaper
        renderMode={VirtualPaperRenderMode.Scroll}
        transform={{ x: 300, y: 200, scale: 1 }}
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    wrapper = screen.getByTestId('virtual-paper-wrapper')
    // originX=max(800,300)=800, scrollLeft=800-300=500
    expect(wrapper.scrollLeft).toBe(500)
    expect(wrapper.scrollTop).toBe(400)
  })

  it('scroll mode wrapper uses overflow:hidden (programmatic scroll, no native scrollbar)', () => {
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
    expect(wrapper.style.overflow).toBe('hidden')
  })

  it('containerStyle and containerClassName apply to scaler in scroll mode', () => {
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
    const scaler = screen.getByTestId('virtual-paper-container')
    expect(scaler.className).toContain('user-container')
    expect(scaler.style.backgroundColor).toBe('red')
  })

  it('scroll mode wires gesture hooks with containerRef pointing to scaledBox', () => {
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
    // 测量会触发 re-render，取最后一次调用的 args 反映最新 ref 绑定
    const calls = vi.mocked(useMultiDragInteractions).mock.calls
    const args = calls[calls.length - 1][0]
    expect(args.containerRef.current).not.toBeNull()
    // containerRef 应指向 scaledBox（其 rect.left === transform.x，保 hooks 语义）
    expect(args.containerRef.current?.getAttribute('data-testid')).toBe(
      'virtual-paper-scroll-box'
    )
  })

  it('default renderMode is Transform (regression: no scroll layers)', () => {
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
