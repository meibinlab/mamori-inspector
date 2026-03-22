'use strict';

/**
 * Stylelint severity を Mamori severity へ変換する。
 * @param {string|undefined} severity Stylelint severity を表す。
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
 * Stylelint JSON から Issue 一覧を構築する。
 * @param {string} rawOutput Stylelint JSON 出力を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseStylelintJson(rawOutput) {
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
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    for (const warning of warnings) {
      issues.push({
        tool: 'stylelint',
        ruleId: typeof warning.rule === 'string' ? warning.rule : undefined,
        message: typeof warning.text === 'string' ? warning.text : 'stylelint finding',
        severity: mapSeverity(warning.severity),
        filePath: typeof result.source === 'string' ? result.source : undefined,
        line: typeof warning.line === 'number' ? warning.line : undefined,
        column: typeof warning.column === 'number' ? warning.column : undefined,
      });
    }
  }

  return issues;
}

module.exports = {
  parseStylelintJson,
};