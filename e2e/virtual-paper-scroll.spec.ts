import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const EVIDENCE_DIR = '.omo/evidence'
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

async function saveEvidence(page: Page, fileName: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${fileName}`, fullPage: true })
}

test.describe('VirtualPaper Scroll Render Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="render-mode-Scroll"]').click()
  })

  test('S8: renders 4-layer structure with scroll geometry', async ({ page }) => {
    await expect(
      page.locator('[data-testid="virtual-paper-scroll-surface"]')
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="virtual-paper-scroll-box"]')
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="virtual-paper-container"]')
    ).toBeVisible()

    const surfaceBox = await page
      .locator('[data-testid="virtual-paper-scroll-surface"]')
      .boundingBox()
    expect(surfaceBox).not.toBeNull()
    expect(surfaceBox!.width).toBeGreaterThan(0)
    expect(surfaceBox!.height).toBeGreaterThan(0)

    // 初始 center placement 下 wrapper.scrollLeft 非零（origin slack 撑开）
    const scrollLeft = await page
      .locator('[data-testid="virtual-paper-wrapper"]')
      .evaluate((el) => (el as HTMLElement).scrollLeft)
    expect(scrollLeft).toBeGreaterThan(0)

    await saveEvidence(page, 'scroll-mode-4-layer.png')
  })

  test('S9: ctrl wheel zoom increases scale in scroll mode', async ({ page }) => {
    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const initial = await readTransform(page)

    await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 })

    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(initial.scale)

    await saveEvidence(page, 'scroll-mode-wheel-zoom.png')
  })

  test('S10: wheel pan changes transform in scroll mode', async ({ page }) => {
    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const initial = await readTransform(page)

    await wrapper.dispatchEvent('wheel', { deltaX: 50, deltaY: 30 })

    await expect
      .poll(async () => {
        const current = await readTransform(page)
        return current.x !== initial.x || current.y !== initial.y
      })
      .toBe(true)

    await saveEvidence(page, 'scroll-mode-wheel-pan.png')
  })

  test('S11: mode switch preserves transform state', async ({ page }) => {
    const initial = await readTransform(page)

    // scroll -> transform
    await page.locator('[data-testid="render-mode-Transform"]').click()
    await expect(
      page.locator('[data-testid="virtual-paper-container"]')
    ).toHaveCSS('transform', /matrix/)

    // transform -> scroll，transform 状态应保留（readout 不变）
    await page.locator('[data-testid="render-mode-Scroll"]').click()
    await expect
      .poll(async () => {
        const current = await readTransform(page)
        return (
          Math.abs(current.x - initial.x) < 1 &&
          Math.abs(current.y - initial.y) < 1 &&
          Math.abs(current.scale - initial.scale) < 0.01
        )
      })
      .toBe(true)

    await saveEvidence(page, 'scroll-mode-switch.png')
  })
})
