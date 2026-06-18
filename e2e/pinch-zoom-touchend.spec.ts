import { expect, test } from '@playwright/test'
import type { CDPSession, Page } from '@playwright/test'

/**
 * 双指缩放 TouchEnd 跳变回归测试（真实浏览器 CDP 多指触摸）。
 *
 * 根因回顾：@system-ui-js/multi-drag 在 finishPointer 时会先删除手指再 setPoseOnEnd，
 * 导致 applyPose('end') 拿不到 2 指 midpoint → 落入增量分支 → 把缩放期间从未使用的
 * 「孤儿位移」(pose.position) 当成最终 translate 叠加，产生视觉跳变。
 *
 * 本测试通过 CDP Input.dispatchTouchEvent 模拟真实多指触摸事件序列：
 *   touchStart(2指) → touchMove(双指外扩缩放) → touchEnd(仅抬1指)
 * 并断言抬指瞬间 x/y 不跳变（仅 scale 保持缩放结果）。
 */

const TRANSFORM_RE = /x: ([\d.-]+), y: ([\d.-]+), scale: ([\d.-]+)/

type TransformReadout = { x: number; y: number; scale: number }

async function readTransform(page: Page): Promise<TransformReadout> {
  const text = await page
    .locator('[data-testid="transform-readout"]')
    .innerText()
  const match = text.match(TRANSFORM_RE)
  expect(match, `Unexpected transform readout: ${text}`).not.toBeNull()
  return {
    x: Number(match?.[1]),
    y: Number(match?.[2]),
    scale: Number(match?.[3])
  }
}

/** 通过 CDP 发送多指触摸事件 */
async function dispatchTouch(
  client: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Array<{ x: number; y: number; id: number }>
) {
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({
      x: p.x,
      y: p.y,
      radiusX: 1,
      radiusY: 1,
      force: 1,
      id: p.id
    })),
    modifiers: 0,
    timestamp: Date.now()
  })
}

test.describe('Pinch zoom TouchEnd jump', () => {
  test('lifting one finger after pinch does not jump x/y', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState?.('networkidle')
    // 等待读数稳定
    await expect(
      page.locator('[data-testid="transform-readout"]')
    ).toBeVisible()

    // 确认 TouchTwoFingerZoom 已启用（默认开）
    await expect(
      page.locator('[data-testid="mode-toggle-TouchTwoFingerZoom"]')
    ).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()

    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // 开启 CDP 触摸模拟
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: true
    })

    // 初始变换（scale 应为 1）
    const initial = await readTransform(page)
    expect(initial.scale).toBeCloseTo(1, 1)

    // ── 双指按下（两点间距 100px） ──
    const halfSpreadStart = 50
    await dispatchTouch(client, 'touchStart', [
      { x: cx - halfSpreadStart, y: cy, id: 0 },
      { x: cx + halfSpreadStart, y: cy, id: 1 }
    ])

    // ── 双指外扩（间距 100 → 240，scale 应增大） ──
    const halfSpreadEnd = 120
    await dispatchTouch(client, 'touchMove', [
      { x: cx - halfSpreadEnd, y: cy, id: 0 },
      { x: cx + halfSpreadEnd, y: cy, id: 1 }
    ])

    // 等待缩放更新落地
    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(1.3)

    // ── 关键：抬第一根手指（2 → 1），此刻为跳变点 ──
    const beforeLift = await readTransform(page)
    await dispatchTouch(client, 'touchEnd', [{ x: cx - halfSpreadEnd, y: cy, id: 0 }])
    await page.waitForTimeout(150) // 等 setPoseOnEnd + React 回调落地

    const afterLift = await readTransform(page)

    // 抬指后 scale 应回落到/保持缩放结果（不应跳回 1）
    expect(afterLift.scale).toBeGreaterThan(1.2)

    // 核心：x/y 不应跳变。bug 会让 x/y 飞到「孤儿位移」处（几十~几百 px 偏移）。
    // 容差 3px 覆盖浮点误差。
    expect(Math.abs(afterLift.x - beforeLift.x)).toBeLessThanOrEqual(3)
    expect(Math.abs(afterLift.y - beforeLift.y)).toBeLessThanOrEqual(3)

    // 收尾：抬第二根手指（1 → 0），不应产生新跳变
    await dispatchTouch(client, 'touchEnd', [{ x: cx + halfSpreadEnd, y: cy, id: 1 }])
    await page.waitForTimeout(150)
    const afterAllLift = await readTransform(page)
    expect(Math.abs(afterAllLift.x - afterLift.x)).toBeLessThanOrEqual(3)
    expect(Math.abs(afterAllLift.y - afterLift.y)).toBeLessThanOrEqual(3)
  })

  test('remaining finger move after lift does not jump when TouchSingleFingerPan is enabled', async ({
    page
  }) => {
    // ── 场景：同时启用 TouchSingleFingerPan + TouchTwoFingerZoom ──
    //   2 指缩放中 → 1 指抬起 → 剩下 1 指 move
    //   预期：剩下手指的 move 不应触发位移叠加跳变
    //   （旧 bug：controller 在 multi 期间累积的 pose.position 被当成新位移叠加）
    //   修复：singlePanBlockedAfterMultiRef 在 multi→single 转换时置 true，
    //         屏蔽剩下手指的后续 move，直到 AllEnd 时 reset。
    await page.goto('/')
    await page.waitForLoadState?.('networkidle')
    await expect(
      page.locator('[data-testid="transform-readout"]')
    ).toBeVisible()

    // 确认 TouchTwoFingerZoom 已启用（默认开）
    await expect(
      page.locator('[data-testid="mode-toggle-TouchTwoFingerZoom"]')
    ).toBeChecked()

    // 启用 TouchSingleFingerPan（如果默认未启用）
    const singlePanToggle = page.locator(
      '[data-testid="mode-toggle-TouchSingleFingerPan"]'
    )
    if (!(await singlePanToggle.isChecked())) {
      await singlePanToggle.check()
    }
    await expect(singlePanToggle).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()

    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // 开启 CDP 触摸模拟
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: true
    })

    // ── 双指按下（两点间距 100px） ──
    const halfSpreadStart = 50
    await dispatchTouch(client, 'touchStart', [
      { x: cx - halfSpreadStart, y: cy, id: 0 },
      { x: cx + halfSpreadStart, y: cy, id: 1 }
    ])

    // ── 双指外扩（间距 100 → 240，scale 应增大） ──
    const halfSpreadEnd = 120
    await dispatchTouch(client, 'touchMove', [
      { x: cx - halfSpreadEnd, y: cy, id: 0 },
      { x: cx + halfSpreadEnd, y: cy, id: 1 }
    ])

    // 等待缩放更新落地
    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(1.3)

    // ── 抬第一根手指（2 → 1） ──
    await dispatchTouch(client, 'touchEnd', [
      { x: cx - halfSpreadEnd, y: cy, id: 0 }
    ])
    await page.waitForTimeout(150) // 等 setPoseOnEnd + React 回调落地

    const afterLift = await readTransform(page)

    // ── 关键：剩下那根手指继续 move（多步） ──
    //   旧 bug：每一步 move 都会叠加位移，最终 x/y 飞到很远
    //   修复后：singlePanBlockedAfterMultiRef 屏蔽这些 move，x/y 保持 frozen
    const remainingId = 1
    const moves: Array<{ x: number; y: number }> = [
      { x: cx + halfSpreadEnd + 40, y: cy + 20 },
      { x: cx + halfSpreadEnd + 80, y: cy + 40 },
      { x: cx + halfSpreadEnd + 120, y: cy + 60 }
    ]
    for (const m of moves) {
      await dispatchTouch(client, 'touchMove', [
        { x: m.x, y: m.y, id: remainingId }
      ])
      await page.waitForTimeout(50)
    }

    await page.waitForTimeout(150)
    const afterMove = await readTransform(page)

    // 断言：剩下手指 move 后 x/y 不应跳变（仍等于 afterLift 时的 frozen 值）
    // 容差 3px 覆盖浮点误差
    expect(Math.abs(afterMove.x - afterLift.x)).toBeLessThanOrEqual(3)
    expect(Math.abs(afterMove.y - afterLift.y)).toBeLessThanOrEqual(3)
    // scale 也应保持不变
    expect(Math.abs(afterMove.scale - afterLift.scale)).toBeLessThanOrEqual(0.05)

    // ── 收尾：抬最后一根手指（1 → 0） ──
    //   AllEnd 触发 clearGesture，reset singlePanBlockedAfterMultiRef
    await dispatchTouch(client, 'touchEnd', [
      { x: moves[moves.length - 1].x, y: moves[moves.length - 1].y, id: remainingId }
    ])
    await page.waitForTimeout(150)
    const afterAllLift = await readTransform(page)
    expect(Math.abs(afterAllLift.x - afterMove.x)).toBeLessThanOrEqual(3)
    expect(Math.abs(afterAllLift.y - afterMove.y)).toBeLessThanOrEqual(3)

    // ── 下一轮：纯单指 pan 应正常工作（flag 已被 clearGesture reset） ──
    const singleFingerId = 2
    const panStart = await readTransform(page)
    await dispatchTouch(client, 'touchStart', [
      { x: cx, y: cy, id: singleFingerId }
    ])
    await dispatchTouch(client, 'touchMove', [
      { x: cx + 50, y: cy + 30, id: singleFingerId }
    ])
    await page.waitForTimeout(150)
    const panAfter = await readTransform(page)

    // 单指 pan 后 x/y 必须实际变化（证明 flag 已 reset，新 single pan 正常工作）
    expect(Math.abs(panAfter.x - panStart.x)).toBeGreaterThan(5)
    expect(Math.abs(panAfter.y - panStart.y)).toBeGreaterThan(5)

    // 清理
    await dispatchTouch(client, 'touchEnd', [
      { x: cx + 50, y: cy + 30, id: singleFingerId }
    ])
  })
})
