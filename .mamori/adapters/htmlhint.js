'use strict';

/**
 * htmlhint severity を Mamori severity へ変換する。
 * @param {string|undefined} severity htmlhint severity を表す。
 * @returns {string} Mamori severity を返す。
 */
function mapSeverity(severity) {
  if (severity === 'error') {
    return 'error';
  }
  if (severity === 'warning') {
    return 'warning';
  }
  return 'info';
}

/**
 * htmlhint JSON から Issue 一覧を構築する。
 * @param {string} rawOutput htmlhint JSON 出力を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseHtmlhintJson(rawOutput) {
  if (typeof rawOutput !== 'string' || rawOutput.trim() === '') {
    return [];
  }

  let parsedOutput;
  try {
    parsedOutput = JSON.parse(rawOutput);
  } catch {
    return [];
  }

  if (!Array.isArray(parsedOutput)) {
    return [];
  }

  const issues = [];
  for (const result of parsedOutput) {
    const messages = Array.isArray(result.messages) ? result.messages : [];
    for (const message of messages) {
      const ruleId = message.rule && typeof message.rule.id === 'string'
        ? message.rule.id
        : (typeof message.ruleId === 'string' ? message.ruleId : undefined);

      issues.push({
        tool: 'htmlhint',
        ruleId,
        message: typeof message.message === 'string' ? message.message : 'htmlhint finding',
        severity: mapSeverity(typeof message.type === 'string' ? message.type : undefined),
        filePath: typeof result.file === 'string'
          ? result.file
          : (typeof result.filePath === 'string' ? result.filePath : undefined),
        line: typeof message.line === 'number' ? message.line : undefined,
        column: typeof message.col === 'number'
          ? message.col
          : (typeof message.column === 'number' ? message.column : undefined),
      });
    }
  }

  return issues;
}

module.exports = {
  parseHtmlhintJson,
};