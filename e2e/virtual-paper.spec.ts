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

async function expectTransformReadout(
  page: Page,
  expected: TransformReadout
) {
  await expect
    .poll(async () => {
      const current = await readTransform(page)

      return (
        current.x === expected.x &&
        current.y === expected.y &&
        current.scale === expected.scale
      )
    })
    .toBe(true)
}

async function saveEvidence(page: Page, fileName: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${fileName}`, fullPage: true })
}

test.describe('VirtualPaper Browser Gestures', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Default center placement', async ({ page }) => {
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

    await saveEvidence(page, 'task-9-default-center.png')
  })

  test('Wheel pan', async ({ page }) => {
    await expect(
      page.locator('[data-testid="mode-toggle-TrackpadScrollPan"]')
    ).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const initial = await readTransform(page)

    await wrapper.dispatchEvent('wheel', { deltaX: 50, deltaY: 30 })
    await waitForTransformChange(page, initial, ['x', 'y'])

    await saveEvidence(page, 'task-9-wheel-pan.png')
  })

  test('Ctrl wheel zoom', async ({ page }) => {
    await expect(
      page.locator('[data-testid="mode-toggle-TrackpadPinchZoom"]')
    ).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const initial = await readTransform(page)

    await wrapper.dispatchEvent('wheel', {
      ctrlKey: true,
      deltaY: -100
    })

    await expect
      .poll(async () => {
        const current = await readTransform(page)

        return current.scale
      })
      .toBeGreaterThan(initial.scale)

    await saveEvidence(page, 'task-9-ctrl-zoom.png')
  })

  test('Disabled wheel pan ignored', async ({ page }) => {
    await page.locator('[data-testid="mode-toggle-TrackpadScrollPan"]').click()
    await expect(
      page.locator('[data-testid="mode-toggle-TrackpadScrollPan"]')
    ).not.toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const initial = await readTransform(page)

    await wrapper.dispatchEvent('wheel', { deltaX: 50, deltaY: 30 })
    await page.waitForTimeout(200)

    const current = await readTransform(page)
    expect(current.x).toBe(initial.x)
    expect(current.y).toBe(initial.y)

    await saveEvidence(page, 'task-9-disabled-wheel.png')
  })

  test('Controlled mode', async ({ page }) => {
    await page.locator('[data-testid="controlled-toggle"]').click()
    await page.locator('[data-testid="controlled-x-input"]').fill('120')
    await page.locator('[data-testid="controlled-y-input"]').fill('80')
    await page.locator('[data-testid="controlled-scale-input"]').fill('1.5')
    await page.locator('[data-testid="apply-controlled-transform"]').click()

    await page
      .locator('[data-testid="virtual-paper-wrapper"]')
      .dispatchEvent('wheel', { deltaX: 0, deltaY: 0 })

    await expectTransformReadout(page, { x: 120, y: 80, scale: 1.5 })
    await expect(page.locator('[data-testid="virtual-paper-container"]')).toHaveCSS(
      'transform',
      'matrix(1.5, 0, 0, 1.5, 120, 80)'
    )

    await saveEvidence(page, 'task-9-controlled-mode.png')
  })

  test('Mouse drag pan', async ({ page }) => {
    await page.locator('[data-testid="mode-toggle-MouseDragPan"]').click()
    await expect(
      page.locator('[data-testid="mode-toggle-MouseDragPan"]')
    ).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const initial = await readTransform(page)
    const box = await wrapper.boundingBox()

    expect(box).not.toBeNull()

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      box!.x + box!.width / 2 + 100,
      box!.y + box!.height / 2 + 50
    )
    await page.mouse.up()
    await page.waitForTimeout(100)

    await waitForTransformChange(page, initial, ['x', 'y'])

    await saveEvidence(page, 'task-9-mouse-drag.png')
  })
})
