/**
 * AI 相关的部署级开关。
 *
 * 聊天历史条数、频率窗口、每日上限等运营参数已经迁到设置中心（V3 表 10），
 * 这里不再保留同名常量——它们的值由 readChatRules() / 计费服务在请求时现读。
 * 留在本文件的只有 readAiInteger 这个解析工具：worker 的租约、批量等技术参数
 * 仍然走环境变量，因为它们是部署事实，不是运营可调项。
 */
const readAiInteger = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name];
  if (raw === undefined || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};

export { readAiInteger };
