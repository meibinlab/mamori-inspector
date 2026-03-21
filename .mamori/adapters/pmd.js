'use strict';

/**
 * 文字列を Issue 向けに復元する。
 * @param {string|undefined} value 元の文字列を表す。
 * @returns {string|undefined} 復元した文字列を返す。
 */
function decodeXml(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&gt;/gu, '>')
    .replace(/&lt;/gu, '<')
    .replace(/&amp;/gu, '&');
}

/**
 * PMD priority を Issue severity へ変換する。
 * @param {string|undefined} priority priority 値を表す。
 * @returns {string} severity を返す。
 */
function mapPriority(priority) {
  const numericPriority = Number(priority);
  if (numericPriority > 0 && numericPriority <= 2) {
    return 'error';
  }
  if (numericPriority > 0 && numericPriority <= 4) {
    return 'warning';
  }
  return 'info';
}

/**
 * PMD XML から Issue 一覧を構築する。
 * @param {string} rawXml PMD XML を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parsePmdXml(rawXml) {
  if (typeof rawXml !== 'string' || !rawXml.includes('<pmd')) {
    return [];
  }

  const issues = [];
  const filePattern = /<file\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/file>/gu;
  const violationPattern = /<violation\s+([^>]+)>([\s\S]*?)<\/violation>/gu;

  for (const fileMatch of rawXml.matchAll(filePattern)) {
    const filePath = decodeXml(fileMatch[1]);
    const fileBody = fileMatch[2] || '';

    for (const violationMatch of fileBody.matchAll(violationPattern)) {
      const attributes = violationMatch[1] || '';
      const message = decodeXml((violationMatch[2] || '').trim()) || 'pmd finding';
      const lineMatch = attributes.match(/beginline="(\d+)"/u);
      const columnMatch = attributes.match(/begincolumn="(\d+)"/u);
      const ruleMatch = attributes.match(/rule="([^"]+)"/u);
      const priorityMatch = attributes.match(/priority="([^"]+)"/u);

      issues.push({
        tool: 'pmd',
        ruleId: decodeXml(ruleMatch && ruleMatch[1] ? ruleMatch[1] : undefined),
        message,
        severity: mapPriority(priorityMatch && priorityMatch[1] ? priorityMatch[1] : undefined),
        filePath,
        line: lineMatch ? Number(lineMatch[1]) : undefined,
        column: columnMatch ? Number(columnMatch[1]) : undefined,
      });
    }
  }

  return issues;
}

module.exports = {
  parsePmdXml,
};