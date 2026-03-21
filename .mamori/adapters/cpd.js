'use strict';

/**
 * CPD XML から Issue 一覧を構築する。
 * @param {string} rawXml CPD XML を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseCpdXml(rawXml) {
  if (typeof rawXml !== 'string' || !rawXml.includes('<pmd-cpd')) {
    return [];
  }

  const issues = [];
  const duplicationPattern = /<duplication\s+lines="(\d+)"\s+tokens="(\d+)"[^>]*>([\s\S]*?)<\/duplication>/gu;
  const filePattern = /<file\s+path="([^"]+)"\s+line="(\d+)"\s*\/>/gu;

  for (const duplicationMatch of rawXml.matchAll(duplicationPattern)) {
    const duplicatedLines = duplicationMatch[1];
    const filesBody = duplicationMatch[3] || '';
    const fileMatches = [...filesBody.matchAll(filePattern)];

    for (const fileMatch of fileMatches) {
      issues.push({
        tool: 'cpd',
        ruleId: 'cpd.duplication',
        message: `Duplicated block detected (${duplicatedLines} lines)`,
        severity: 'warning',
        filePath: fileMatch[1],
        line: Number(fileMatch[2]),
        column: 1,
      });
    }
  }

  return issues;
}

module.exports = {
  parseCpdXml,
};