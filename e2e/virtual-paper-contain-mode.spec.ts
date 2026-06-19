import { expect, test } from '@playwright/test'
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

async function saveEvidence(page: Page, fileName: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${fileName}`, fullPage: true })
}

test.describe('contain mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('fitted content centers after enabling contain mode', async ({ page }) => {
    // 启用 contain mode，内容默认 600×400 在更大的 wrapper 内属于 fitted
    await page.locator('[data-testid="contain-mode-toggle"]').check()
    // 触发一次微小的 wheel 事件，让 hook 有机会将投影后的 transform 写回 readout
    await page
      .locator('[data-testid="virtual-paper-wrapper"]')
      .dispatchEvent('wheel', { deltaX: 0, deltaY: 0 })
    await page.waitForTimeout(150)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    const wrapperBox = await wrapper.boundingBox()
    const containerBox = await container.boundingBox()

    expect(wrapperBox).not.toBeNull()
    expect(containerBox).not.toBeNull()

    const wrapperCenter = {
      x: wrapperBox!.x + wrapperBox!.width / 2,
      y: wrapperBox!.y + wrapperBox!.height / 2
    }
    const containerCenter = {
      x: containerBox!.x + containerBox!.width / 2,
      y: containerBox!.y + containerBox!.height / 2
    }

    expect(Math.abs(containerCenter.x - wrapperCenter.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(containerCenter.y - wrapperCenter.y)).toBeLessThanOrEqual(2)

    await saveEvidence(page, 'task-7-contain-center.png')
  })

  test('oversized content cannot be panned to leave horizontal/vertical blank space', async ({ page }) => {
    await page.locator('[data-testid="contain-mode-toggle"]').check()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')

    // 先放大到内容溢出 wrapper
    await wrapper.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(
        new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: -400,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true
        })
      )
    })
    await page.waitForTimeout(200)

    // 向多个方向猛 pan，试图拖出空白
    await wrapper.dispatchEvent('wheel', { deltaX: 800, deltaY: 800 })
    await page.waitForTimeout(150)
    await wrapper.dispatchEvent('wheel', { deltaX: -800, deltaY: -800 })
    await page.waitForTimeout(150)

    const wrapperBox = await wrapper.boundingBox()
    const containerBox = await page
      .locator('[data-testid="virtual-paper-container"]')
      .boundingBox()

    expect(wrapperBox).not.toBeNull()
    expect(containerBox).not.toBeNull()

    // 若水平方向溢出，则左右两侧均不应出现空白
    if (containerBox!.width > wrapperBox!.width) {
      expect(containerBox!.x).toBeLessThanOrEqual(wrapperBox!.x + 1)
      expect(containerBox!.x + containerBox!.width).toBeGreaterThanOrEqual(
        wrapperBox!.x + wrapperBox!.width - 1
      )
    }

    // 若垂直方向溢出，则上下两侧均不应出现空白
    if (containerBox!.height > wrapperBox!.height) {
      expect(containerBox!.y).toBeLessThanOrEqual(wrapperBox!.y + 1)
      expect(containerBox!.y + containerBox!.height).toBeGreaterThanOrEqual(
        wrapperBox!.y + wrapperBox!.height - 1
      )
    }

    await saveEvidence(page, 'task-7-contain-pan-clamp.png')
  })

  test('ctrl-wheel zoom projects fitted axis to center after scaling', async ({ page }) => {
    // 使用一个较高的视口，使得放大后水平溢出、垂直仍 fitted
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')

    await page.locator('[data-testid="contain-mode-toggle"]').check()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    // 以 wrapper 中心为锚点进行缩放
    await wrapper.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(
        new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: -280,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true
        })
      )
    })
    await page.waitForTimeout(200)

    const wrapperBox = await wrapper.boundingBox()
    const containerBox = await container.boundingBox()

    expect(wrapperBox).not.toBeNull()
    expect(containerBox).not.toBeNull()

    // 水平方向若溢出，应 clamp，不允许左右留白
    if (containerBox!.width > wrapperBox!.width) {
      expect(containerBox!.x).toBeLessThanOrEqual(wrapperBox!.x + 1)
      expect(containerBox!.x + containerBox!.width).toBeGreaterThanOrEqual(
        wrapperBox!.x + wrapperBox!.width - 1
      )
    } else {
      // 若水平仍 fitted，应居中
      const wrapperCenterX = wrapperBox!.x + wrapperBox!.width / 2
      const containerCenterX = containerBox!.x + containerBox!.width / 2
      expect(Math.abs(containerCenterX - wrapperCenterX)).toBeLessThanOrEqual(2)
    }

    // 垂直方向若 fitted，应居中
    if (containerBox!.height <= wrapperBox!.height) {
      const wrapperCenterY = wrapperBox!.y + wrapperBox!.height / 2
      const containerCenterY = containerBox!.y + containerBox!.height / 2
      expect(Math.abs(containerCenterY - wrapperCenterY)).toBeLessThanOrEqual(2)
    } else {
      // 若垂直溢出，应 clamp，不允许上下留白
      expect(containerBox!.y).toBeLessThanOrEqual(wrapperBox!.y + 1)
      expect(containerBox!.y + containerBox!.height).toBeGreaterThanOrEqual(
        wrapperBox!.y + wrapperBox!.height - 1
      )
    }

    await saveEvidence(page, 'task-7-contain-zoom.png')
  })

  test('reader mode with contain toggle still behaves like reader mode', async ({ page }) => {
    // 先启用阅读模式
    await page.locator('[data-testid="reader-mode-toggle"]').check()
    await page.waitForTimeout(100)

    // 再启用 contain mode（应在 readerMode 下被忽略）
    await page.locator('[data-testid="contain-mode-toggle"]').check()
    await page.waitForTimeout(100)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    // Reader mode 下 wrapper 的 overflow 应为 auto
    await expect(wrapper).toHaveCSS('overflow', 'auto')

    // Reader mode 下 container 不应有 CSS transform
    await expect(container).toHaveCSS('transform', 'none')

    await saveEvidence(page, 'task-7-reader-noop.png')
  })
})
