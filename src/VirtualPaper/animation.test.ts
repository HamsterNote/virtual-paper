import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpringAnimation } from './animation'
import type { VirtualPaperTransform } from './types'

// ---------------------------------------------------------------------------
// rAF mock — manual frame advancement for deterministic spring stepping
// ---------------------------------------------------------------------------

/**
 * 手动控制 requestAnimationFrame 的 mock。
 * 调用 `flushFrame()` 可以推进一帧，触发已注册的 step 回调。
 */

let rafCallbacks: Map<number, FrameRequestCallback>
let rafIdCounter: number

beforeEach(() => {
  rafCallbacks = new Map()
  rafIdCounter = 1

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = rafIdCounter++
    rafCallbacks.set(id, cb)
    return id
  })

  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    rafCallbacks.delete(id)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 推进一帧：取出当前队列中的所有回调并按注册顺序执行 */
const flushFrame = (): number => {
  // 取快照，避免回调里新增的 rAF 也被本轮执行
  const pending = [...rafCallbacks.values()]
  rafCallbacks.clear()
  const timestamp = performance.now()
  for (const cb of pending) {
    cb(timestamp)
  }
  return pending.length
}

/** 持续推进帧直到动画完成或达到最大帧数（防死循环） */
const flushUntilDone = (maxFrames = 500): number => {
  let totalFrames = 0
  while (totalFrames < maxFrames) {
    const count = flushFrame()
    if (count === 0) break
    totalFrames += 1
  }
  return totalFrames
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 单轴测试：仅在 x 轴上从 100 移动到 0，y/scale 保持不变 */
const AXIS_FROM: VirtualPaperTransform = { x: 100, y: 0, scale: 1 }
const AXIS_TO: VirtualPaperTransform = { x: 0, y: 0, scale: 1 }

// ---------------------------------------------------------------------------
// Tests — 以下测试锁定了 ease 动画的非振荡行为。
// 当前 createSpringAnimation 使用弹簧物理（欠阻尼），会导致过冲和振荡，
// 因此测试 1（单调收敛）和测试 2（无过冲）应当 RED 失败。
// ---------------------------------------------------------------------------

describe('createSpringAnimation — ease rebound invariants', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. 单调收敛：每个中间值都在上一个值和目标之间，方向始终一致
  // ─────────────────────────────────────────────────────────────────────────
  it('approaches target monotonically — no value reverses direction toward the target', () => {
    // Given: 动画从 x=100 向 x=0 移动（正方向→负方向）
    const capturedX: number[] = []

    createSpringAnimation({
      from: AXIS_FROM,
      to: AXIS_TO,
      onUpdate: (t) => {
        capturedX.push(t.x)
      }
    })

    // When: 执行所有帧直到动画结束
    flushUntilDone()

    // Then: 每一步的 x 值都不应比前一步更远离目标（即不应反向变大）
    for (let i = 1; i < capturedX.length; i++) {
      const prev = capturedX[i - 1]!
      const curr = capturedX[i]!
      // 从 100→0 移动，所以每步 x 应该 ≤ 前一步 x（单调递减）
      // 允许相等（静止帧），但不允许反向增大
      expect(curr).toBeLessThanOrEqual(prev)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 2. 无过冲：最终值永远不超过 to（不会变成负数）
  // ─────────────────────────────────────────────────────────────────────────
  it('never overshoots beyond the target value', () => {
    // Given: 动画从 x=100 向 x=0 移动
    const capturedX: number[] = []

    createSpringAnimation({
      from: AXIS_FROM,
      to: AXIS_TO,
      onUpdate: (t) => {
        capturedX.push(t.x)
      }
    })

    // When: 执行所有帧
    flushUntilDone()

    // Then: 所有中间帧的 x 值都应在 [0, 100] 范围内（不会过冲到负数）
    for (const x of capturedX) {
      expect(x).toBeGreaterThanOrEqual(0)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 3. 精确结束：动画结束后最后一个值精确等于 to，onComplete 只调用一次
  // ─────────────────────────────────────────────────────────────────────────
  it('lands exactly on the target and calls onComplete exactly once', () => {
    // Given: 动画从 x=100 向 x=0 移动
    const finalValues: VirtualPaperTransform[] = []
    const completeCalls: number[] = []

    createSpringAnimation({
      from: AXIS_FROM,
      to: AXIS_TO,
      onUpdate: (t) => {
        finalValues.push(t)
      },
      onComplete: () => {
        completeCalls.push(1)
      }
    })

    // When: 执行所有帧
    flushUntilDone()

    // Then: 最后一次 onUpdate 调用的值精确等于 to
    expect(finalValues.length).toBeGreaterThan(0)
    const last = finalValues[finalValues.length - 1]!
    expect(last.x).toBe(0)
    expect(last.y).toBe(0)
    expect(last.scale).toBe(1)

    // onComplete 恰好调用一次
    expect(completeCalls).toHaveLength(1)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 4. 取消：cancel() 后不再触发 onUpdate 或 onComplete
  // ─────────────────────────────────────────────────────────────────────────
  it('stops all callbacks after cancel() is called', () => {
    // Given: 动画刚开始，捕获初始帧
    const capturedValues: number[] = []
    const completeCalls: number[] = []

    const cancel = createSpringAnimation({
      from: AXIS_FROM,
      to: AXIS_TO,
      onUpdate: (t) => {
        capturedValues.push(t.x)
      },
      onComplete: () => {
        completeCalls.push(1)
      }
    })

    // When: 推进一帧后立即取消
    flushFrame()
    const countBeforeCancel = capturedValues.length
    cancel()

    // 再推进若干帧确认没有新回调
    flushUntilDone()

    // Then: 取消后的值不会再增加，onComplete 不会被调用
    expect(capturedValues).toHaveLength(countBeforeCancel)
    expect(completeCalls).toHaveLength(0)
  })
})
