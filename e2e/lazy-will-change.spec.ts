// allow: SIZE_OK — CDP touch and wheel lazy-will-change browser regression matrix stays cohesive.
import { expect, test } from '@playwright/test'
import type { CDPSession, Page } from '@playwright/test'

const EVIDENCE_DIR = '.omo/evidence'

async function triggerCtrlWheelZoom(page: Page) {
  const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
  await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 })
}

/** 通过 CDP 发送单指/多指触摸事件（复用 pinch-zoom-touchend.spec.ts 模式） */
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

test.describe('Demo lazyWillChange control', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')

    await expect(
      page.locator('[data-testid="mode-toggle-MouseWheelCtrlZoom"]')
    ).toBeChecked()
  })

  test('lazy will-change toggle is unchecked and ms input hidden by default', async ({
    page
  }) => {
    const toggle = page.locator('[data-testid="lazy-will-change-toggle"]')
    await expect(toggle).not.toBeChecked()

    const msInput = page.locator('[data-testid="lazy-will-change-ms-input"]')
    await expect(msInput).toBeHidden()

    await page.screenshot({
      path: `${EVIDENCE_DIR}/lazy-will-change-disabled-default.png`
    })
  })

  test('enabling lazy will-change applies will-change during zoom and removes it after delay', async ({
    page
  }) => {
    const toggle = page.locator('[data-testid="lazy-will-change-toggle"]')
    await toggle.click()
    await expect(toggle).toBeChecked()

    const msInput = page.locator('[data-testid="lazy-will-change-ms-input"]')
    await expect(msInput).toHaveValue('200')

    const container = page.locator('[data-testid="virtual-paper-container"]')

    await triggerCtrlWheelZoom(page)

    await expect(container).toHaveCSS('will-change', 'transform')

    await expect
      .poll(async () => {
        return container.evaluate((el) => getComputedStyle(el).willChange)
      })
      .not.toBe('transform')

    await page.screenshot({
      path: `${EVIDENCE_DIR}/lazy-will-change-enabled.png`
    })
  })

  test('zero delay keeps lazy will-change disabled', async ({ page }) => {
    const toggle = page.locator('[data-testid="lazy-will-change-toggle"]')
    await toggle.click()
    await expect(toggle).toBeChecked()

    const msInput = page.locator('[data-testid="lazy-will-change-ms-input"]')
    await msInput.fill('0')
    await expect(msInput).toHaveValue('0')

    await expect(
      page.locator('[data-testid="lazy-will-change-readout"]')
    ).toContainText('0ms')

    const container = page.locator('[data-testid="virtual-paper-container"]')
    await triggerCtrlWheelZoom(page)

    const willChange = await container.evaluate(
      (el) => getComputedStyle(el).willChange
    )
    expect(willChange).not.toBe('transform')

    await page.screenshot({
      path: `${EVIDENCE_DIR}/lazy-will-change-zero-disabled.png`
    })
  })

  test('custom delay is reflected in readout and honored during zoom', async ({
    page
  }) => {
    const toggle = page.locator('[data-testid="lazy-will-change-toggle"]')
    await toggle.click()
    await expect(toggle).toBeChecked()

    const msInput = page.locator('[data-testid="lazy-will-change-ms-input"]')
    await msInput.fill('500')
    await expect(msInput).toHaveValue('500')

    await expect(
      page.locator('[data-testid="lazy-will-change-readout"]')
    ).toContainText('500ms')

    const container = page.locator('[data-testid="virtual-paper-container"]')
    await triggerCtrlWheelZoom(page)

    await expect(container).toHaveCSS('will-change', 'transform')

    await page.screenshot({
      path: `${EVIDENCE_DIR}/lazy-will-change-custom-delay.png`
    })
  })
})

test.describe('Lazy will-change with CDP touch gestures', () => {
  test('single-finger touch pan activates and clears lazy will-change', async ({
    page
  }) => {
    await page.goto('/')
    await page.waitForLoadState?.('networkidle')

    await expect(
      page.locator('[data-testid="transform-readout"]')
    ).toBeVisible()

    // 启用 lazy will-change（默认 200ms 延迟）
    const toggle = page.locator('[data-testid="lazy-will-change-toggle"]')
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(
      page.locator('[data-testid="lazy-will-change-ms-input"]')
    ).toHaveValue('200')

    // 启用 TouchSingleFingerPan（默认可能未开启）
    const singlePanToggle = page.locator(
      '[data-testid="mode-toggle-TouchSingleFingerPan"]'
    )
    if (!(await singlePanToggle.isChecked())) {
      await singlePanToggle.check()
    }
    await expect(singlePanToggle).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')
    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()

    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // 开启 CDP 触摸模拟
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: true
    })

    // touchStart
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy, id: 0 }])

    // touchMove（向右下方拖拽）
    await dispatchTouch(client, 'touchMove', [
      { x: cx + 80, y: cy + 50, id: 0 }
    ])

    // 断言：拖拽过程中 will-change 应为 transform
    await expect(container).toHaveCSS('will-change', 'transform')

    // touchEnd
    await dispatchTouch(client, 'touchEnd', [{ x: cx + 80, y: cy + 50, id: 0 }])

    // 断言：touchEnd + 200ms 延迟后 will-change 应被清除
    await expect
      .poll(async () => {
        return container.evaluate((el) => getComputedStyle(el).willChange)
      })
      .not.toBe('transform')

    await page.screenshot({
      path: `${EVIDENCE_DIR}/lazy-will-change-touch-pan.png`
    })
  })

  test('two-finger touch pan activates and clears lazy will-change', async ({
    page
  }) => {
    await page.goto('/')
    await page.waitForLoadState?.('networkidle')

    await expect(
      page.locator('[data-testid="transform-readout"]')
    ).toBeVisible()

    // 启用 lazy will-change（默认 200ms 延迟）
    const toggle = page.locator('[data-testid="lazy-will-change-toggle"]')
    await toggle.click()
    await expect(toggle).toBeChecked()

    // 确保 TouchTwoFingerZoom 禁用，避免手势被识别为缩放
    const twoFingerZoomToggle = page.locator(
      '[data-testid="mode-toggle-TouchTwoFingerZoom"]'
    )
    if (await twoFingerZoomToggle.isChecked()) {
      await twoFingerZoomToggle.uncheck()
    }
    await expect(twoFingerZoomToggle).not.toBeChecked()

    // 启用 TouchTwoFingerPan（默认可能未开启）
    const twoFingerPanToggle = page.locator(
      '[data-testid="mode-toggle-TouchTwoFingerPan"]'
    )
    if (!(await twoFingerPanToggle.isChecked())) {
      await twoFingerPanToggle.check()
    }
    await expect(twoFingerPanToggle).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')
    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()

    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // 开启 CDP 触摸模拟
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: true
    })

    // 双指按下（间距 100px）
    const halfSpread = 50
    await dispatchTouch(client, 'touchStart', [
      { x: cx - halfSpread, y: cy, id: 0 },
      { x: cx + halfSpread, y: cy, id: 1 }
    ])

    // 双指同向移动（模拟平移：向右下移动）
    const moveDX = 80
    const moveDY = 50
    await dispatchTouch(client, 'touchMove', [
      { x: cx - halfSpread + moveDX, y: cy + moveDY, id: 0 },
      { x: cx + halfSpread + moveDX, y: cy + moveDY, id: 1 }
    ])

    // 断言：拖拽过程中 will-change 应为 transform
    await expect(container).toHaveCSS('will-change', 'transform')

    // 双指抬起
    await dispatchTouch(client, 'touchEnd', [
      { x: cx - halfSpread + moveDX, y: cy + moveDY, id: 0 },
      { x: cx + halfSpread + moveDX, y: cy + moveDY, id: 1 }
    ])

    // 断言：touchEnd + 200ms 延迟后 will-change 应被清除
    await expect
      .poll(async () => {
        return container.evaluate((el) => getComputedStyle(el).willChange)
      })
      .not.toBe('transform')

    await page.screenshot({
      path: `${EVIDENCE_DIR}/lazy-will-change-touch-two-finger-pan.png`
    })
  })

  test('two-finger pinch zoom activates and clears lazy will-change', async ({
    page
  }) => {
    await page.goto('/')
    await page.waitForLoadState?.('networkidle')

    await expect(
      page.locator('[data-testid="transform-readout"]')
    ).toBeVisible()

    // 启用 lazy will-change（默认 200ms 延迟）
    const toggle = page.locator('[data-testid="lazy-will-change-toggle"]')
    await toggle.click()
    await expect(toggle).toBeChecked()

    // 确认 TouchTwoFingerZoom 已启用（默认开）
    await expect(
      page.locator('[data-testid="mode-toggle-TouchTwoFingerZoom"]')
    ).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')
    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()

    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // 开启 CDP 触摸模拟
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: true
    })

    // 双指按下（间距 100px）
    const halfSpreadStart = 50
    await dispatchTouch(client, 'touchStart', [
      { x: cx - halfSpreadStart, y: cy, id: 0 },
      { x: cx + halfSpreadStart, y: cy, id: 1 }
    ])

    await expect(container).toHaveCSS('will-change', 'transform')

    // 双指外扩缩放（间距 100 → 240px）
    const halfSpreadEnd = 120
    await dispatchTouch(client, 'touchMove', [
      { x: cx - halfSpreadEnd, y: cy, id: 0 },
      { x: cx + halfSpreadEnd, y: cy, id: 1 }
    ])

    // 断言：缩放过程中 will-change 应为 transform
    await expect(container).toHaveCSS('will-change', 'transform')

    // 双指抬起
    await dispatchTouch(client, 'touchEnd', [
      { x: cx - halfSpreadEnd, y: cy, id: 0 },
      { x: cx + halfSpreadEnd, y: cy, id: 1 }
    ])

    // 断言：touchEnd + 200ms 延迟后 will-change 应被清除
    await expect
      .poll(async () => {
        return container.evaluate((el) => getComputedStyle(el).willChange)
      })
      .not.toBe('transform')

    await page.screenshot({
      path: `${EVIDENCE_DIR}/lazy-will-change-touch-pinch.png`
    })
  })
})
