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
 * Checkstyle XML から Issue 一覧を構築する。
 * @param {string} rawXml Checkstyle XML を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseCheckstyleXml(rawXml) {
  if (typeof rawXml !== 'string' || !rawXml.includes('<checkstyle')) {
    return [];
  }

  const issues = [];
  const filePattern = /<file\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/file>/gu;
  const errorPattern = /<error\s+([^>]+?)\/>/gu;

  for (const fileMatch of rawXml.matchAll(filePattern)) {
    const filePath = decodeXml(fileMatch[1]);
    const fileBody = fileMatch[2] || '';

    for (const errorMatch of fileBody.matchAll(errorPattern)) {
      const attributes = errorMatch[1] || '';
      const lineMatch = attributes.match(/line="(\d+)"/u);
      const columnMatch = attributes.match(/column="(\d+)"/u);
      const severityMatch = attributes.match(/severity="([^"]+)"/u);
      const messageMatch = attributes.match(/message="([^"]+)"/u);
      const sourceMatch = attributes.match(/source="([^"]+)"/u);

      issues.push({
        tool: 'checkstyle',
        ruleId: decodeXml(sourceMatch && sourceMatch[1] ? sourceMatch[1] : undefined),
        message: decodeXml(messageMatch && messageMatch[1] ? messageMatch[1] : 'checkstyle finding'),
        severity: severityMatch && severityMatch[1] === 'error' ? 'error' : 'warning',
        filePath,
        line: lineMatch ? Number(lineMatch[1]) : undefined,
        column: columnMatch ? Number(columnMatch[1]) : undefined,
      });
    }
  }

  return issues;
}

module.exports = {
  parseCheckstyleXml,
};