import { cleanup, render, screen } from '@testing-library/react'
import { StrictMode, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMultiDragInteractions } from './useMultiDragInteractions'
import {
  type UseVirtualPaperInteractionArgs,
  VirtualPaperInteractionMode,
  type VirtualPaperTransform,
  type VirtualPaperTransformUpdater
} from './types'

type MockPose = {
  position?: { x: number; y: number }
  width?: number
  height?: number
  scale?: number
}

type MockOptions = {
  getPose?: (element: HTMLElement) => MockPose
  setPose?: (element: HTMLElement, pose: MockPose) => void
  setPoseOnEnd?: (element: HTMLElement, pose: MockPose) => void
  maxFingerCount?: number
  inertial?: boolean
  passive?: boolean
}

type MockPointerEvent = Pick<PointerEvent, 'pointerType' | 'isPrimary'>

type MockFinger = {
  getLastOperation: () => { event?: MockPointerEvent; point?: { x: number; y: number } } | undefined
}

type MockMixinInstance = {
  element: HTMLElement
  options: MockOptions
  mixinTypes: string[]
  singleFingerMixinTypes?: string[]
  fingers: MockFinger[]
  listeners: Map<string, Array<(fingers: MockFinger[]) => void>>
  destroyed: boolean
  destroy: ReturnType<typeof vi.fn>
  addEventListener: (type: string, callback: (fingers: MockFinger[]) => void) => void
  getFingers: () => MockFinger[]
  trigger: (type: string, fingers: MockFinger[]) => void
}

const multiDragMock = vi.hoisted(() => {
  const instances: MockMixinInstance[] = []

  const Mixin = vi.fn(function (
    this: unknown,
    element: HTMLElement,
    options: MockOptions,
    mixinTypes: string[],
    singleFingerMixinTypes?: string[]
  ) {
    const instance = {
      element,
      options,
      mixinTypes,
      singleFingerMixinTypes,
      fingers: [] as MockFinger[],
      listeners: new Map<string, Array<(fingers: MockFinger[]) => void>>(),
      destroyed: false,
      destroy: vi.fn(),
      addEventListener(type: string, callback: (fingers: MockFinger[]) => void) {
        const callbacks = instance.listeners.get(type) ?? []
        callbacks.push(callback)
        instance.listeners.set(type, callbacks)
      },
      getFingers() {
        return instance.fingers
      },
      trigger(type: string, fingers: MockFinger[]) {
        instance.fingers = fingers
        for (const callback of instance.listeners.get(type) ?? []) {
          callback(fingers)
        }
      }
    }

    instance.destroy = vi.fn(() => {
      instance.destroyed = true
      instance.listeners.clear()
    })
    instances.push(instance)
    return instance
  })

  return {
    instances,
    Mixin,
    MixinType: {
      Drag: 'drag',
      Scale: 'scale'
    },
    DragOperationType: {
      Start: 'start',
      Move: 'move',
      End: 'end',
      AllEnd: 'allEnd'
    }
  }
})

vi.mock('@system-ui-js/multi-drag', () => multiDragMock)

type HarnessProps = Partial<UseVirtualPaperInteractionArgs> & {
  transform?: VirtualPaperTransform
  updateTransform?: VirtualPaperTransformUpdater
  endTransform?: VirtualPaperTransformUpdater
}

const defaultTransform = { x: 10, y: 20, scale: 1 }

function TestHarness({
  transform = defaultTransform,
  enabledInteractions = [VirtualPaperInteractionMode.MouseDragPan],
  minScale = 0.25,
  maxScale = 4,
  updateTransform = vi.fn(),
  endTransform = vi.fn()
}: HarnessProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useMultiDragInteractions({
    wrapperRef,
    containerRef,
    transform,
    enabledInteractions,
    minScale,
    maxScale,
    updateTransform,
    endTransform
  })

  return (
    <div ref={wrapperRef} data-testid="wrapper">
      <div ref={containerRef} data-testid="container" />
    </div>
  )
}

const makeRect = (width: number, height: number): DOMRect => {
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON() {
      return this
    }
  } as unknown as DOMRect
}

const makeFinger = (
  pointerType: MockPointerEvent['pointerType'],
  isPrimary = true
): MockFinger => ({
  getLastOperation: () => ({
    event: { pointerType, isPrimary }
  })
})

const makeFingerWithPoint = (
  pointerType: MockPointerEvent['pointerType'],
  isPrimary: boolean,
  point: { x: number; y: number }
): MockFinger => ({
  getLastOperation: () => ({
    event: { pointerType, isPrimary },
    point
  })
})

const getLastInstance = (): MockMixinInstance => {
  const instance = multiDragMock.instances.at(-1)
  if (!instance) throw new Error('Expected a Mixin instance')
  return instance
}

describe('useMultiDragInteractions', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

  beforeEach(() => {
    multiDragMock.instances.length = 0
    multiDragMock.Mixin.mockClear()
    Element.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('data-testid') === 'container') {
        return makeRect(300, 200)
      }

      return originalGetBoundingClientRect.call(this)
    }
  })

  afterEach(() => {
    cleanup()
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  })

  it('cleans up active mixins under StrictMode across repeated mounts', () => {
    const first = render(
      <StrictMode>
        <TestHarness />
      </StrictMode>
    )
    expect(multiDragMock.instances.filter((instance) => !instance.destroyed)).toHaveLength(1)
    expect(getLastInstance().listeners.get('start')).toHaveLength(1)
    expect(getLastInstance().listeners.get('move')).toHaveLength(1)

    first.unmount()
    expect(multiDragMock.instances.filter((instance) => !instance.destroyed)).toHaveLength(0)

    const second = render(
      <StrictMode>
        <TestHarness />
      </StrictMode>
    )
    expect(multiDragMock.instances.filter((instance) => !instance.destroyed)).toHaveLength(1)

    second.unmount()
    expect(multiDragMock.instances.filter((instance) => !instance.destroyed)).toHaveLength(0)
    expect(multiDragMock.instances.every((instance) => instance.destroy.mock.calls.length === 1)).toBe(true)
  })

  it('ignores disabled single-finger touch pan without writing left or top', () => {
    const updateTransform = vi.fn()
    render(
      <TestHarness
        enabledInteractions={[VirtualPaperInteractionMode.TouchTwoFingerPan]}
        updateTransform={updateTransform}
      />
    )

    const instance = getLastInstance()
    const container = screen.getByTestId('container')
    instance.trigger('start', [makeFinger('touch')])
    instance.options.setPose?.(container, {
      position: { x: 40, y: 50 },
      scale: 1
    })

    expect(updateTransform).not.toHaveBeenCalled()
    expect(container.style.left).toBe('')
    expect(container.style.top).toBe('')
    expect(instance.singleFingerMixinTypes).toEqual([])
  })

  it('routes primary mouse drag updates through MouseDragPan metadata', () => {
    const updateTransform = vi.fn()
    const endTransform = vi.fn()
    render(
      <TestHarness
        transform={{ x: 10, y: 20, scale: 2 }}
        enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]}
        updateTransform={updateTransform}
        endTransform={endTransform}
      />
    )

    const instance = getLastInstance()
    const container = screen.getByTestId('container')
    expect(instance.options.getPose?.(container)).toEqual({
      position: { x: 10, y: 20 },
      width: 300,
      height: 200,
      scale: 2
    })

    instance.trigger('start', [makeFinger('mouse')])
    instance.options.setPose?.(container, {
      position: { x: 25, y: 35 },
      scale: 2
    })
    instance.options.setPoseOnEnd?.(container, {
      position: { x: 30, y: 45 },
      scale: 2
    })

    expect(updateTransform).toHaveBeenCalledWith(
      { x: 25, y: 35, scale: 2 },
      {
        source: VirtualPaperInteractionMode.MouseDragPan,
        inputType: 'pointer',
        phase: 'change'
      }
    )
    expect(endTransform).toHaveBeenCalledWith(
      { x: 30, y: 45, scale: 2 },
      {
        source: VirtualPaperInteractionMode.MouseDragPan,
        inputType: 'pointer',
        phase: 'end'
      }
    )
    expect(container.style.left).toBe('')
    expect(container.style.top).toBe('')
  })

  it('only instantiates Mixin when pointer modes are enabled', () => {
    const { rerender } = render(
      <TestHarness
        enabledInteractions={[
          VirtualPaperInteractionMode.MouseWheelZoom,
          VirtualPaperInteractionMode.TrackpadScrollPan
        ]}
      />
    )
    expect(multiDragMock.Mixin).not.toHaveBeenCalled()

    rerender(<TestHarness enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]} />)
    expect(multiDragMock.Mixin).toHaveBeenCalledTimes(1)
    expect(getLastInstance().mixinTypes).toEqual(['drag'])
    expect(getLastInstance().singleFingerMixinTypes).toEqual(['drag'])
  })

  it('configures two-finger touch pan and zoom mixin types', () => {
    render(
      <TestHarness
        enabledInteractions={[
          VirtualPaperInteractionMode.TouchTwoFingerPan,
          VirtualPaperInteractionMode.TouchTwoFingerZoom
        ]}
      />
    )

    expect(getLastInstance().mixinTypes).toEqual(['drag', 'scale'])
    expect(getLastInstance().singleFingerMixinTypes).toEqual([])
  })

  it('anchors two-finger pinch at the finger midpoint so content follows the fingers', () => {
    const updateTransform = vi.fn()
    render(
      <TestHarness
        transform={{ x: 0, y: 0, scale: 1 }}
        enabledInteractions={[VirtualPaperInteractionMode.TouchTwoFingerZoom]}
        updateTransform={updateTransform}
      />
    )

    const instance = getLastInstance()
    const container = screen.getByTestId('container')

    const fingerA = makeFingerWithPoint('touch', true, { x: 100, y: 100 })
    const fingerB = makeFingerWithPoint('touch', false, { x: 300, y: 100 })

    instance.trigger('start', [fingerA, fingerB])

    instance.options.setPose?.(container, { position: { x: 0, y: 0 }, scale: 2 })

    expect(updateTransform).toHaveBeenCalledTimes(1)
    expect(updateTransform).toHaveBeenCalledWith(
      { x: -200, y: -100, scale: 2 },
      {
        source: VirtualPaperInteractionMode.TouchTwoFingerZoom,
        inputType: 'pointer',
        phase: 'change'
      }
    )
  })

  // 复现双指缩放 TouchEnd 跳变 bug：
  // 缩放过程中位置正确，但抬起一根手指的瞬间会额外叠加一份位移（scale 不变）。
  // 根因：真实库 @system-ui-js/multi-drag 的 DragBase.finishPointer（base.ts）顺序为
  //   finger.record(End) -> finger.destroy() -> fingers.delete()  // 抬起的手指先从 map 移除
  //   -> setPose(snapshot, End)  即 options.setPoseOnEnd           // 先执行（此时 refs 还是旧值）
  //   -> trigger('end')                                          // 后执行（trackGesture 来不及）
  // 所以 applyPose('end') 跑的时候 getFingers() 已只剩 1 根 -> midpoint 为 null -> isAnchorZoom=false
  // -> 落入"增量分支"，把控制器在缩放期间独立累积、却从未被锚点分支使用过的 pose.position
  //    当成新位移叠加，造成"TouchEnd 增加一份位移"。
  it('freezes position when a finger lifts mid-pinch instead of applying an orphan pan delta', () => {
    const updateTransform = vi.fn()
    const endTransform = vi.fn()
    render(
      <TestHarness
        transform={{ x: 0, y: 0, scale: 1 }}
        enabledInteractions={[VirtualPaperInteractionMode.TouchTwoFingerZoom]}
        updateTransform={updateTransform}
        endTransform={endTransform}
      />
    )

    const instance = getLastInstance()
    const container = screen.getByTestId('container')

    const fingerA = makeFingerWithPoint('touch', true, { x: 100, y: 100 })
    const fingerB = makeFingerWithPoint('touch', false, { x: 300, y: 100 })

    // 1. 缩放手势开始：两根手指，捕获锚点段
    instance.trigger('start', [fingerA, fingerB])

    // 2. 缩放过程中：scale 1 -> 2，走锚点分支（位置由 midpoint+scale 决定，忽略 pose.position）
    instance.options.setPose?.(container, { scale: 2 })
    expect(updateTransform).toHaveBeenCalledTimes(1)

    // 3. 抬起 fingerA。严格按真实库顺序：先把该手指从 fingers map 删除，再调 setPoseOnEnd。
    //    （'end' 事件监听器里的 trackGesture/captureZoomSegment 在真实库里是 setPoseOnEnd 之后才跑，
    //     对本次 end 来不及生效。）
    instance.fingers = [fingerB]
    instance.options.setPoseOnEnd?.(container, {
      scale: 2,
      // 控制器在缩放期间独立累积的 pose.position —— 锚点分支从没用过它。
      // 若 end 阶段错误走增量分支，就会把这份"孤儿位移"叠加成可见跳变。
      position: { x: 50, y: 30 }
    })

    expect(endTransform).toHaveBeenCalledTimes(1)
    const [endedTransform] = endTransform.mock.calls[0]

    // scale 始终正确（两分支共用 nextScale）
    expect(endedTransform.scale).toBe(2)
    // 位置必须冻结在当前 transform，绝不能跳到控制器的孤儿位移 (50, 30)。
    // 修复前（bug）：增量分支产出 { x: 50, y: 30, scale: 2 }。
    // 修复后：冻结产出 { x: 0, y: 0, scale: 2 }（真实场景下会冻结到 move 的最终锚点位置）。
    expect(endedTransform).toEqual({ x: 0, y: 0, scale: 2 })
  })

  // ─────────────────────────────────────────────────────────────────────
  // 复现用户报告的 bug：
  // "同时打开 TouchSingleFingerPan + TouchTwoFingerZoom 还是会跳，
  //  在 TouchEnd 的时候位移会叠加一段"
  //
  // 根因（现有 didScaleDuringGestureRef freeze 只 cover 了 lift 那一帧 phase==='end'，
  //      但漏掉了剩下手指继续 move 触发的 phase==='change'）：
  //   1. 2 指缩放中 → didScaleDuringGestureRef = true
  //   2. 1 指抬起 → End 事件 → freeze 分支命中 ✓（位置冻结 OK）
  //   3. 剩下 1 指继续 move → applyPose('change')：
  //      - zoomSegmentRef 已被 End 事件的 captureZoomSegment 清空
  //      - currentMid = null（fingers.length < 2）
  //      - isAnchorZoom = false
  //      - phase !== 'end' → freeze 分支不命中
  //      - 因为 TouchSingleFingerPan 启用，source = TouchSingleFingerPan（绕过 line 244 early return）
  //      - 落入第三分支（delta 累加）→ 跳变！
  //
  // 修复策略（参考 painting 的 singleTrackingDisabledUntilReset 预防式模式）：
  //   在 multi→single 转换时设置屏蔽 flag，屏蔽后续所有 single pan 更新，
  //   直到 AllEnd 重置。
  //
  // 严格按真实库 @system-ui-js/multi-drag 的事件顺序：
  //   1. finger.record(End) → finger.destroy() → fingers.delete()  // fingers map 先删
  //   2. setPoseOnEnd                                       // 先调（refs 还是旧值）
  //   3. trigger('end')                                     // 后调（trackGesture 才生效）
  //   4. （剩下手指 move 时）setPose                         // applyPose('change')
  //   5. trigger('move')                                    // trackGesture 维持 single pan
  // ─────────────────────────────────────────────────────────────────────
  it('blocks single-finger pan after multi→single transition (no jump on remaining finger move)', () => {
    const updateTransform = vi.fn()
    const endTransform = vi.fn()
    render(
      <TestHarness
        transform={{ x: 0, y: 0, scale: 1 }}
        // 关键：同时启用单指 pan + 双指 zoom —— 这是用户报告的 bug 触发条件
        enabledInteractions={[
          VirtualPaperInteractionMode.TouchSingleFingerPan,
          VirtualPaperInteractionMode.TouchTwoFingerZoom
        ]}
        updateTransform={updateTransform}
        endTransform={endTransform}
      />
    )

    const instance = getLastInstance()
    const container = screen.getByTestId('container')

    const fingerA = makeFingerWithPoint('touch', true, { x: 100, y: 100 })
    const fingerB = makeFingerWithPoint('touch', false, { x: 300, y: 100 })

    // ── 步骤 1: 双指按下，捕获 zoom 锚点段 ──
    instance.trigger('start', [fingerA, fingerB])
    // activeGestureRef = { panSource: undefined, zoomSource: TouchTwoFingerZoom }
    //   (TouchTwoFingerPan 没开，所以 panSource 不设；只有 zoomSource)
    // zoomSegmentRef 已捕获

    // ── 步骤 2: 缩放中（scale 1 → 2），走 anchor zoom 分支 ──
    instance.options.setPose?.(container, { scale: 2 })
    expect(updateTransform).toHaveBeenCalledTimes(1)
    // didScaleDuringGestureRef = true
    const zoomedTransform = updateTransform.mock.calls[0][0] as VirtualPaperTransform
    expect(zoomedTransform.scale).toBe(2)

    // ── 步骤 3: fingerA 抬起。严格按真实库顺序：先把 fingerA 从 fingers map 删除 ──
    instance.fingers = [fingerB]
    // ── 步骤 3a: 真实库先调 setPoseOnEnd（此时 refs 还是旧的 multi 状态）──
    instance.options.setPoseOnEnd?.(container, {
      scale: 2,
      // 控制器在缩放期间独立累积的 pose.position —— 锚点分支从没用过它
      position: { x: 50, y: 30 }
    })
    // 此时：isAnchorZoom=false（currentMid=null），phase='end' & didScale=true → freeze 命中
    // endTransform 被调用一次（位置冻结）
    expect(endTransform).toHaveBeenCalledTimes(1)
    const endedTransform = endTransform.mock.calls[0][0] as VirtualPaperTransform
    expect(endedTransform).toEqual({ x: 0, y: 0, scale: 2 })

    // ── 步骤 3b: 真实库后触发 'end' 事件（trackGesture 此刻才更新 refs）──
    //   模拟 trackGesture 检测到 multi→single 转换 → 应设置 singlePanBlockedAfterMultiRef
    instance.trigger('end', [fingerB])
    // captureZoomSegment 也被调用 → 清空 zoomSegmentRef（因 fingers.length < 2）
    // activeGestureRef 更新为 { panSource: TouchSingleFingerPan }（1 指 + 该模式启用）

    // ── 步骤 4: 关键场景 —— 剩下的 fingerB 继续 move ──
    //   真实库：先调 setPose（applyPose 'change'），后触发 'move' 事件
    updateTransform.mockClear()
    instance.options.setPose?.(container, {
      scale: 2,
      // 控制器继续累积的位移 —— 这就是 bug 的"位移叠加一段"
      position: { x: 80, y: 40 }
    })

    // *** 修复前（bug）***：updateTransform 会被调用，并把 (80, 40) 当作新位移叠加
    // *** 修复后 ***：source=TouchSingleFingerPan 且 singlePanBlockedAfterMultiRef=true
    //                → applyPose 顶部 gate 直接 return，updateTransform 不被调用
    expect(
      updateTransform,
      '剩下手指继续 move 时绝不能触发 transform 更新（应被 singleTrackingDisabled 屏蔽）'
    ).not.toHaveBeenCalled()

    // ── 步骤 5: 'move' 事件后触发（trackGesture 维持 single pan，不影响结果）──
    instance.trigger('move', [fingerB])
    expect(updateTransform).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────────────
  // S3 回归：multi→single 屏蔽后，所有手指抬起应清空 flag，
  //          下一轮纯单指 pan 必须正常工作（不能被错误屏蔽）
  // ─────────────────────────────────────────────────────────────────────
  it('resets the multi→single block flag on AllEnd so the next single-finger pan works', () => {
    const updateTransform = vi.fn()
    const endTransform = vi.fn()
    render(
      <TestHarness
        transform={{ x: 0, y: 0, scale: 1 }}
        enabledInteractions={[
          VirtualPaperInteractionMode.TouchSingleFingerPan,
          VirtualPaperInteractionMode.TouchTwoFingerZoom
        ]}
        updateTransform={updateTransform}
        endTransform={endTransform}
      />
    )

    const instance = getLastInstance()
    const container = screen.getByTestId('container')

    const fingerA = makeFingerWithPoint('touch', true, { x: 100, y: 100 })
    const fingerB = makeFingerWithPoint('touch', false, { x: 300, y: 100 })

    // ── 第一轮：双指 zoom → 单指 lift → AllEnd（完整走完屏蔽流程）──
    instance.trigger('start', [fingerA, fingerB])
    instance.options.setPose?.(container, { scale: 2 })
    instance.fingers = [fingerB]
    instance.options.setPoseOnEnd?.(container, { scale: 2, position: { x: 50, y: 30 } })
    instance.trigger('end', [fingerB])
    // fingerB 也抬起
    instance.fingers = []
    instance.options.setPoseOnEnd?.(container, { scale: 2, position: { x: 0, y: 0 } })
    instance.trigger('end', [])
    // AllEnd 触发 clearGesture → 应清空 singlePanBlockedAfterMultiRef
    instance.trigger('allEnd', [])

    // ── 第二轮：全新的单指 pan（无前置 multi）──
    updateTransform.mockClear()
    endTransform.mockClear()
    const fingerC = makeFingerWithPoint('touch', true, { x: 50, y: 50 })
    instance.trigger('start', [fingerC])
    // activeGestureRef = { panSource: TouchSingleFingerPan }（无 zoomSource）

    instance.options.setPose?.(container, {
      scale: 1,
      position: { x: 70, y: 60 }
    })

    // *** 关键断言 ***：新一轮单指 pan 必须正常触发 updateTransform
    //   修复前若未在 clearGesture 中重置 flag，会被错误屏蔽
    expect(
      updateTransform,
      'AllEnd 后新一轮单指 pan 必须正常工作'
    ).toHaveBeenCalledTimes(1)
    const panTransform = updateTransform.mock.calls[0][0] as VirtualPaperTransform
    expect(panTransform).toEqual({ x: 70, y: 60, scale: 1 })
  })
})
