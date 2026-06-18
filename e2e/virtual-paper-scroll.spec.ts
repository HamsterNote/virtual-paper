import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const EVIDENCE_DIR = '.omo/evidence'
const TRANSFORM_RE = /x: ([\d.-]+), y: ([\d.-]+), scale: ([\d.-]+)/

type TransformReadout = { x: number; y: number; scale: number }

// 读取 demo 页面上的 transform 读数（testid=transform-readout）
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

// 保存证据截图到 .omo/evidence 目录
async function saveEvidence(page: Page, fileName: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${fileName}`, fullPage: true })
}

test.describe('VirtualPaper Scroll Render Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="render-mode-Scroll"]').click()
  })

  // S8: 新架构为 2 层结构（wrapper + container），wrapper 使用 overflow:auto 原生滚动，
  // container 使用文档流 + width/height 缩放，无 transform
  test('S8: renders 2-layer structure with native scroll container', async ({ page }) => {
    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    // wrapper + container 可见
    await expect(wrapper).toBeVisible()
    await expect(container).toBeVisible()

    // 旧架构的 scroll-surface / scroll-box 层不应存在
    await expect(
      page.locator('[data-testid="virtual-paper-scroll-surface"]')
    ).toHaveCount(0)
    await expect(
      page.locator('[data-testid="virtual-paper-scroll-box"]')
    ).toHaveCount(0)

    // wrapper 使用原生 overflow:auto 滚动（而非旧的 overflow:hidden + 编程式 origin slack）
    await expect(wrapper).toHaveCSS('overflow', 'auto')

    // container 无 transform（新架构使用 width/height 缩放，不用 transform:scale）
    await expect(container).toHaveCSS('transform', /none/)

    // container 宽高 = contentSize × scale（demo contentSize=600×400, scale=1）
    const containerBox = await container.boundingBox()
    expect(containerBox).not.toBeNull()
    expect(Math.round(containerBox!.width)).toBe(600)
    expect(Math.round(containerBox!.height)).toBe(400)

    await saveEvidence(page, 'scroll-mode-2-layer.png')
  })

  // S9: scroll 模式下 ctrl+wheel 缩放仍由 JS 处理（preventDefault + applyZoomAnchor）
  test('S9: ctrl wheel zoom increases scale in scroll mode', async ({ page }) => {
    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const initial = await readTransform(page)

    await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 })

    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(initial.scale)

    await saveEvidence(page, 'scroll-mode-wheel-zoom.png')
  })

  // S10: 放大后 container 超出 wrapper，原生滚动生效，transform.x = -scrollLeft 同步
  test('S10: native scroll syncs transform after zoom', async ({ page }) => {
    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')

    // 先放大使 container 超出 wrapper（多次 ctrl+wheel 累加 scale → ~2x）
    // 单次 deltaY=-200 约放大到 ~1.49，需要分多次累加以确保 scale > 1.5
    await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -200 })
    await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -200 })
    await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -200 })
    await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -200 })
    await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -200 })
    await wrapper.dispatchEvent('wheel', { ctrlKey: true, deltaY: -200 })
    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(2)

    // 放大后 wrapper 应可滚动（scrollWidth > clientWidth）
    const overflow = await wrapper.evaluate((el) => {
      const div = el as HTMLElement
      return {
        scrollWidth: div.scrollWidth,
        clientWidth: div.clientWidth
      }
    })
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth)

    // 编程式设置 scrollLeft 触发原生 scroll 事件
    const targetScroll = 100
    await wrapper.evaluate((el, val) => {
      (el as HTMLElement).scrollLeft = val
    }, targetScroll)

    // transform.x 应同步为 -scrollLeft（scroll 右移 → 内容左移 → x 变负）
    await expect
      .poll(async () => {
        const current = await readTransform(page)
        return current.x
      })
      .toBeLessThan(-targetScroll + 5) // 容差 5px，x ≈ -100

    await saveEvidence(page, 'scroll-mode-native-scroll.png')
  })

  // S11: scroll ↔ transform 模式切换，transform 状态（x/y/scale）应保留
  test('S11: mode switch preserves transform state', async ({ page }) => {
    const initial = await readTransform(page)

    // scroll -> transform：container 应有 CSS transform（matrix）
    await page.locator('[data-testid="render-mode-Transform"]').click()
    await expect(
      page.locator('[data-testid="virtual-paper-container"]')
    ).toHaveCSS('transform', /matrix/)

    // transform -> scroll：transform 状态应保留（readout 不变）
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
