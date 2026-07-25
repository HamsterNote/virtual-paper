import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const EVIDENCE_DIR = '.omo/evidence'
const TRANSFORM_RE = /x: ([\d.-]+), y: ([\d.-]+), scale: ([\d.-]+)/

type TransformReadout = {
  x: number
  y: number
  scale: number
}

type DemoContentMetrics = {
  padding: number
  gap: number
  headingFontSize: number
  cardHeight: number
  cardBorderRadius: number
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

async function readDemoContentMetrics(page: Page): Promise<DemoContentMetrics> {
  return page.locator('[data-testid="demo-big-card"]').evaluate((element) => {
    const card = element.querySelector<HTMLElement>('[data-testid="demo-card-1"]')
    const heading = element.querySelector<HTMLElement>('h2')

    if (!card || !heading) {
      throw new Error('Demo content is incomplete')
    }

    const rootStyle = getComputedStyle(element)
    const cardStyle = getComputedStyle(card)

    return {
      padding: Number.parseFloat(rootStyle.paddingTop),
      gap: Number.parseFloat(rootStyle.rowGap),
      headingFontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
      cardHeight: Number.parseFloat(cardStyle.height),
      cardBorderRadius: Number.parseFloat(cardStyle.borderTopLeftRadius)
    }
  })
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

  test('reader mode scales internal dimensions only after zoom commits', async ({
    page
  }) => {
    // Given：仅启用阅读模式，不依赖普通 transform 模式的“等比缩放”开关。
    await page.click('[data-testid="reader-mode-toggle"]')
    await expect(page.locator('[data-testid="reader-mode-toggle"]')).toBeChecked()
    await expect(
      page.locator('[data-testid="proportional-scaling-toggle"]')
    ).not.toBeChecked()

    const container = page.locator('.paper-stage .virtual-paper-container')
    const initialMetrics = await readDemoContentMetrics(page)
    const bigCard = page.locator('[data-testid="demo-big-card"]')
    const initialOverflow = await bigCard.evaluate((element) => ({
      horizontal: element.scrollWidth - element.clientWidth,
      vertical: element.scrollHeight - element.clientHeight
    }))

    // When：触发一次阅读模式滚轮缩放，先进入 CSS transform 预览阶段。
    const box = await container.boundingBox()
    expect(box).not.toBeNull()
    await container.dispatchEvent('wheel', {
      deltaY: -300,
      ctrlKey: true,
      clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2
    })

    await expect
      .poll(async () => container.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe('none')

    // Then：预览阶段只由外层 transform 缩放，内部尺寸仍保持基础值，避免双重缩放。
    const previewMetrics = await readDemoContentMetrics(page)
    expect(previewMetrics).toEqual(initialMetrics)

    // Then：防抖提交后移除 transform，并让字体、padding、gap、圆角和卡片高度等比变化。
    await expect
      .poll(async () => container.evaluate((element) => getComputedStyle(element).transform))
      .toBe('none')

    const committedTransform = await readTransform(page)
    const committedMetrics = await readDemoContentMetrics(page)
    expect(committedTransform.scale).toBeGreaterThan(1)
    expect(committedMetrics.padding).toBeCloseTo(
      initialMetrics.padding * committedTransform.scale,
      1
    )
    expect(committedMetrics.gap).toBeCloseTo(
      initialMetrics.gap * committedTransform.scale,
      1
    )
    expect(committedMetrics.headingFontSize).toBeCloseTo(
      initialMetrics.headingFontSize * committedTransform.scale,
      1
    )
    expect(committedMetrics.cardHeight).toBeCloseTo(
      initialMetrics.cardHeight * committedTransform.scale,
      1
    )
    expect(committedMetrics.cardBorderRadius).toBeCloseTo(
      initialMetrics.cardBorderRadius * committedTransform.scale,
      1
    )

    const committedOverflow = await bigCard.evaluate((element) => ({
      horizontal: element.scrollWidth - element.clientWidth,
      vertical: element.scrollHeight - element.clientHeight
    }))
    // scrollWidth/scrollHeight 会取整，因此按比例后的裁切量允许 1px 舍入误差。
    expect(
      Math.abs(
        committedOverflow.horizontal -
          initialOverflow.horizontal * committedTransform.scale
      )
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        committedOverflow.vertical -
          initialOverflow.vertical * committedTransform.scale
      )
    ).toBeLessThanOrEqual(1)

    await page.screenshot({
      path: `${EVIDENCE_DIR}/reader-mode-content-scaling-committed.png`,
      fullPage: true
    })

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    await wrapper.evaluate((element) => {
      element.scrollTo({ left: element.scrollWidth, top: element.scrollHeight })
    })
    await page.screenshot({
      path: `${EVIDENCE_DIR}/reader-mode-content-scaling-scroll-end.png`,
      fullPage: true
    })

    // When：重置已提交的阅读模式缩放。
    await page.click('[data-testid="reset-transform"]')

    // Then：纸张与内部尺寸同时回到基础比例。
    await expect.poll(async () => (await readTransform(page)).scale).toBe(1)
    expect(await readDemoContentMetrics(page)).toEqual(initialMetrics)
  })

  test('controlled reader scale keeps paper and content coherent through reset', async ({
    page
  }) => {
    // Given：启用阅读模式和受控模式，并应用 2 倍缩放。
    await page.click('[data-testid="reader-mode-toggle"]')
    await page.click('[data-testid="controlled-toggle"]')
    await page.fill('[data-testid="controlled-scale-input"]', '2')
    await page.click('[data-testid="apply-controlled-transform"]')

    const container = page.locator('.paper-stage .virtual-paper-container')

    // Then：纸张布局与内部尺寸使用同一个受控比例。
    await expect(container).toHaveCSS('width', '1200px')
    await expect(container).toHaveCSS('height', '800px')
    const scaledMetrics = await readDemoContentMetrics(page)
    expect(scaledMetrics.padding).toBeCloseTo(48, 1)
    expect(scaledMetrics.headingFontSize).toBeCloseTo(44, 1)
    expect(scaledMetrics.cardHeight).toBeCloseTo(160, 1)

    // When：重置受控阅读模式。
    await page.click('[data-testid="reset-transform"]')

    // Then：受控值、纸张布局和内部尺寸全部恢复基础比例。
    await expect(page.locator('[data-testid="controlled-scale-input"]')).toHaveValue(
      '1'
    )
    await expect(container).toHaveCSS('width', '600px')
    await expect(container).toHaveCSS('height', '400px')
    const resetMetrics = await readDemoContentMetrics(page)
    expect(resetMetrics.padding).toBeCloseTo(24, 1)
    expect(resetMetrics.headingFontSize).toBeCloseTo(22, 1)
    expect(resetMetrics.cardHeight).toBeCloseTo(80, 1)
  })
})
