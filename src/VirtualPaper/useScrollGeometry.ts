import type { VirtualPaperContentSize } from './types'

export type UseScrollGeometryArgs = {
  enabled: boolean
  contentSize?: VirtualPaperContentSize
}

export type UseScrollGeometryResult = {
  baseSize: { width: number; height: number }
}

// scroll 模式基础尺寸解析 hook。
// contentSize prop 优先；未提供时返回 {0,0}，container 使用 auto 尺寸（缩放不生效）。
// v1 限制：无 contentSize 时无法在 2 层 DOM 内可靠测量未缩放尺寸，仅原生滚动 pan 可用。
export function useScrollGeometry({ contentSize }: UseScrollGeometryArgs): UseScrollGeometryResult {
  const baseSize = contentSize ?? { width: 0, height: 0 }
  return { baseSize }
}
