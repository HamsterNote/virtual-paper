import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const EVIDENCE_DIR = '.omo/evidence'

async function triggerCtrlWheelZoom(page: Page) {
  const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
  await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 })
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
