/** 规范化地址栏输入；缺省使用 HTTPS，拒绝凭据和非网页协议。 */
export function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('请输入网页地址。');
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[\w.-]+:\d+(?:[/?#]|$)/.test(trimmed);
  const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('请输入不含账户密码的 HTTP 或 HTTPS 地址。');
  }
  return url.href;
}
