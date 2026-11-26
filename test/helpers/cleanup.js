import { rmSync } from 'node:fs'

/**
 * 删测试临时目录。Windows 上 sqlite/WAL 或媒体句柄可能晚于用例结束才释放，
 * 直接 rm 会 EPERM/EBUSY；重试几次仍不行就留给系统临时目录清理，不让清理掩盖断言结果。
 */
export function cleanupDir (dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  } catch (error) {
    if (!['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(error.code)) throw error
  }
}
