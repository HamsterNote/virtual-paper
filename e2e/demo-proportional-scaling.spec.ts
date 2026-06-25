import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const EVIDENCE_DIR = '.omo/evidence'
const TRANSFORM_RE = /x: ([\d.-]+), y: ([\d.-]+), scale: ([\d.-]+)/

type TransformReadout = {
  x: number
  y: number
  scale: number
}

async function readTransform(page: Page): Promise<TransformReadout> {
  const readout = page.locator('[data-testid="transform-readout"]')
  const text = await readout.innerText()
  const match = text.match(TRANSFORM_RE)

  expect(match, `Unexpected transform readout: ${text}`).not.toBeNull()

  return {
    x: Number(match?.[1]),
    y: Number(match?.[2]),
    scale: Number(match?.[3])
  }
}

/**
 * 等比缩放 e2e 测试：
 * 开启等比缩放后，用户通过 Ctrl+滚轮缩放画布时，
 * 大卡片内部元素（字体、Card 高度、间距等）应随大卡片宽度等比变化。
 */
test.describe('Demo proportional scaling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')

    await expect(
      page.locator('[data-testid="mode-toggle-MouseWheelCtrlZoom"]')
    ).toBeChecked()
  })

  test('enabling proportional scaling makes internal dimensions scale with big-card width', async ({
    page
  }) => {
    // 开启等比缩放。
    await page.click('[data-testid="proportional-scaling-toggle"]')
    await expect(
      page.locator('[data-testid="proportional-scaling-toggle"]')
    ).toBeChecked()

    // 获取大卡片元素。
    const bigCard = page.locator('[data-testid="demo-big-card"]')
    await expect(bigCard).toBeVisible()

    // 记录缩放前的大卡片宽度和 Card 高度。
    const initialWidth = await bigCard.evaluate(
      (el) => el.getBoundingClientRect().width
    )
    const initialCardHeight = await page
      .locator('[data-testid="demo-card-1"]')
      .evaluate((el) => parseFloat(getComputedStyle(el).height))
    const initialHeadingSize = await page
      .locator('[data-testid="demo-big-card"] h2')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

    expect(initialWidth).toBeCloseTo(600, 0)
    expect(initialCardHeight).toBeCloseTo(80, 0)
    expect(initialHeadingSize).toBeCloseTo(22, 0)

    // 在画布上 Ctrl+滚轮放大：按住 Ctrl 再滚轮。
    const container = page.locator('.paper-stage .virtual-paper-container')
    await container.hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -600)
    await page.keyboard.up('Control')

    // 等待缩放动画/变换稳定。
    await expect
      .poll(async () => {
        const t = await readTransform(page)
        return t.scale
      })
      .toBeGreaterThan(1.2)

    // 记录放大后的尺寸。
    const zoomedWidth = await bigCard.evaluate(
      (el) => el.getBoundingClientRect().width
    )
    const zoomedCardHeight = await page
      .locator('[data-testid="demo-card-1"]')
      .evaluate((el) => parseFloat(getComputedStyle(el).height))
    const zoomedHeadingSize = await page
      .locator('[data-testid="demo-big-card"] h2')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

    const scale = zoomedWidth / initialWidth
    expect(scale).toBeGreaterThan(1.2)
    expect(zoomedCardHeight).toBeCloseTo(initialCardHeight * scale, 0)
    expect(zoomedHeadingSize).toBeCloseTo(initialHeadingSize * scale, 0)

    // 保存证据截图。
    await page.screenshot({
      path: `${EVIDENCE_DIR}/proportional-scaling-enabled.png`
    })
  })

  test('demo big-card fills container height and clips overflow', async ({
    page
  }) => {
    const bigCard = page.locator('[data-testid="demo-big-card"]')
    await expect(bigCard).toBeVisible()

    const style = await bigCard.evaluate((el) => {
      const computed = getComputedStyle(el)
      return {
        height: computed.height,
        overflow: computed.overflow,
        parentHeight: el.parentElement
          ? el.parentElement.getBoundingClientRect().height
          : null
      }
    })

    expect(style.height).toBe('400px')
    expect(style.overflow).toBe('hidden')
    expect(style.parentHeight).toBeCloseTo(400, 0)

    await page.screenshot({
      path: `${EVIDENCE_DIR}/demo-big-card-height-overflow.png`
    })
  })

  test('disabling proportional scaling keeps internal dimensions fixed during zoom', async ({
    page
  }) => {
    // 默认等比缩放关闭。
    await expect(
      page.locator('[data-testid="proportional-scaling-toggle"]')
    ).not.toBeChecked()

    const bigCard = page.locator('[data-testid="demo-big-card"]')
    await expect(bigCard).toBeVisible()

    const initialCardHeight = await page
      .locator('[data-testid="demo-card-1"]')
      .evaluate((el) => parseFloat(getComputedStyle(el).height))
    const initialHeadingSize = await page
      .locator('[data-testid="demo-big-card"] h2')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

    expect(initialCardHeight).toBeCloseTo(80, 0)
    expect(initialHeadingSize).toBeCloseTo(22, 0)

    // Ctrl+滚轮放大。
    const container = page.locator('.paper-stage .virtual-paper-container')
    await container.hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -600)
    await page.keyboard.up('Control')

    await expect
      .poll(async () => {
        const t = await readTransform(page)
        return t.scale
      })
      .toBeGreaterThan(1.2)

    const zoomedCardHeight = await page
      .locator('[data-testid="demo-card-1"]')
      .evaluate((el) => parseFloat(getComputedStyle(el).height))
    const zoomedHeadingSize = await page
      .locator('[data-testid="demo-big-card"] h2')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

    // 关闭等比缩放时，Card 高度和字体大小应保持原始值不变。
    expect(zoomedCardHeight).toBeCloseTo(initialCardHeight, 0)
    expect(zoomedHeadingSize).toBeCloseTo(initialHeadingSize, 0)

    await page.screenshot({
      path: `${EVIDENCE_DIR}/proportional-scaling-disabled.png`
    })
  })
})
