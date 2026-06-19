import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const EVIDENCE_DIR = '.omo/evidence'
const TRANSFORM_RE = /x: ([\d.-]+), y: ([\d.-]+), scale: ([\d.-]+)/
const CONTENT_SIZE = { width: 600, height: 400 }
const READER_SCROLLABLE_VIEWPORT = { width: 760, height: 360 }
const WHEEL_ANCHOR_INSIDE_WRAPPER = { clientX: 420, clientY: 180 }

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

async function waitForTransformChange(
  page: Page,
  initial: TransformReadout,
  fields: Array<keyof TransformReadout>
) {
  await expect
    .poll(async () => {
      const current = await readTransform(page)

      return fields.every((field) => current[field] !== initial[field])
    })
    .toBe(true)
}

async function saveEvidence(page: Page, fileName: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${fileName}`, fullPage: true })
}

async function enableReaderMode(page: Page) {
  await page.locator('[data-testid="reader-mode-toggle"]').check()
  await expect(page.locator('[data-testid="reader-mode-toggle"]')).toBeChecked()
  await expect(page.locator('[data-testid="virtual-paper-wrapper"]')).toHaveCSS(
    'overflow',
    'auto'
  )
}

async function zoomReaderPastScale(page: Page, targetScale: number) {
  const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')

  for (let i = 0; i < 8; i += 1) {
    const before = await readTransform(page)
    if (before.scale > targetScale) return before

    await wrapper.dispatchEvent('wheel', {
      ctrlKey: true,
      ...WHEEL_ANCHOR_INSIDE_WRAPPER,
      deltaY: -220
    })

    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(before.scale)
  }

  const current = await readTransform(page)
  expect(current.scale).toBeGreaterThan(targetScale)
  return current
}

test.describe('VirtualPaper readerMode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(READER_SCROLLABLE_VIEWPORT)
    await page.goto('/')
  })

  test('renders 2-layer reader structure without container transform', async ({
    page
  }) => {
    await enableReaderMode(page)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    await expect(wrapper).toBeVisible()
    await expect(container).toBeVisible()
    await expect(wrapper).toHaveCSS('overflow', 'auto')
    await expect(container).toHaveCSS('transform', /none/)
    await expect(container).toHaveCSS('position', 'relative')

    const geometry = await container.evaluate((el) => {
      const style = window.getComputedStyle(el)
      const rect = el.getBoundingClientRect()

      return {
        position: style.position,
        transform: style.transform,
        width: rect.width,
        height: rect.height
      }
    })

    expect(geometry.position).toBe('relative')
    expect(geometry.transform).toBe('none')
    expect(Math.round(geometry.width)).toBe(CONTENT_SIZE.width)
    expect(Math.round(geometry.height)).toBe(CONTENT_SIZE.height)

    await saveEvidence(page, 'reader-mode-structure.png')
  })

  test('syncs native scroll positions back to negative transform coordinates', async ({
    page
  }) => {
    await enableReaderMode(page)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')

    await wrapper.evaluate((el) => {
      const div = el as HTMLElement
      div.scrollLeft = 100
      div.scrollTop = 30
    })

    await expect
      .poll(async () => {
        const current = await readTransform(page)
        return {
          x: Math.round(current.x),
          y: Math.round(current.y)
        }
      })
      .toEqual({ x: -100, y: -30 })

    await saveEvidence(page, 'reader-mode-native-scroll-sync.png')
  })

  test('increases scale after ctrl wheel zoom debounce', async ({ page }) => {
    await enableReaderMode(page)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')

    for (let i = 0; i < 3; i += 1) {
      const before = await readTransform(page)
      await wrapper.dispatchEvent('wheel', {
        ctrlKey: true,
        ...WHEEL_ANCHOR_INSIDE_WRAPPER,
        deltaY: -200
      })
      await expect
        .poll(async () => (await readTransform(page)).scale)
        .toBeGreaterThan(before.scale)
    }

    await saveEvidence(page, 'reader-mode-ctrl-wheel-zoom.png')
  })

  test('keeps zoomed reader layout bounded without blank overflow', async ({
    page
  }) => {
    await enableReaderMode(page)

    const scale = (await zoomReaderPastScale(page, 2)).scale
    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    const containerBox = await container.boundingBox()
    expect(containerBox).not.toBeNull()
    expect(containerBox!.width).toBeCloseTo(CONTENT_SIZE.width * scale, 0)
    expect(containerBox!.height).toBeCloseTo(CONTENT_SIZE.height * scale, 0)

    const bounds = await wrapper.evaluate((el) => {
      const div = el as HTMLElement
      const maxScrollLeft = Math.max(0, div.scrollWidth - div.clientWidth)
      const maxScrollTop = Math.max(0, div.scrollHeight - div.clientHeight)

      return {
        scrollLeft: div.scrollLeft,
        scrollTop: div.scrollTop,
        scrollWidth: div.scrollWidth,
        scrollHeight: div.scrollHeight,
        clientWidth: div.clientWidth,
        clientHeight: div.clientHeight,
        maxScrollLeft,
        maxScrollTop
      }
    })

    expect(bounds.scrollWidth).toBeGreaterThanOrEqual(bounds.clientWidth)
    expect(bounds.scrollHeight).toBeGreaterThanOrEqual(bounds.clientHeight)
    expect(bounds.scrollLeft).toBeGreaterThanOrEqual(0)
    expect(bounds.scrollTop).toBeGreaterThanOrEqual(0)
    expect(bounds.scrollLeft).toBeLessThanOrEqual(bounds.maxScrollLeft + 1)
    expect(bounds.scrollTop).toBeLessThanOrEqual(bounds.maxScrollTop + 1)

    await saveEvidence(page, 'reader-mode-bounded-zoom.png')
  })

  test('keeps default transform mode CSS transform and wheel pan behavior', async ({
    page
  }) => {
    await expect(page.locator('[data-testid="reader-mode-toggle"]')).not.toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')
    const initial = await readTransform(page)

    await expect(container).toHaveCSS('transform', /matrix/)

    await wrapper.dispatchEvent('wheel', { deltaX: 50, deltaY: 30 })
    await waitForTransformChange(page, initial, ['x', 'y'])

    const current = await readTransform(page)
    expect(current.x).toBeLessThan(initial.x)
    expect(current.y).toBeLessThan(initial.y)
    await expect(container).toHaveCSS('transform', /matrix/)

    await saveEvidence(page, 'reader-mode-transform-regression.png')
  })
})
