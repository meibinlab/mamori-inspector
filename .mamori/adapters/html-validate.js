'use strict';

/**
 * HTML-Validate severity を Mamori severity へ変換する。
 * @param {number|undefined} severity HTML-Validate severity を表す。
 * @returns {string} Mamori severity を返す。
 */
function mapSeverity(severity) {
  if (severity === 2) {
    return 'error';
  }
  if (severity === 1) {
    return 'warning';
  }
  return 'info';
}

/**
 * HTML-Validate JSON から Issue 一覧を構築する。
 * @param {string} rawOutput HTML-Validate JSON 出力を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseHtmlValidateJson(rawOutput) {
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
      issues.push({
        tool: 'html-validate',
        ruleId: typeof message.ruleId === 'string' ? message.ruleId : undefined,
        message: typeof message.message === 'string' ? message.message : 'html-validate finding',
        severity: mapSeverity(typeof message.severity === 'number' ? message.severity : undefined),
        filePath: typeof result.filePath === 'string' ? result.filePath : undefined,
        line: typeof message.line === 'number' ? message.line : undefined,
        column: typeof message.column === 'number' ? message.column : undefined,
      });
    }
  }

  return issues;
}

module.exports = {
  parseHtmlValidateJson,
};