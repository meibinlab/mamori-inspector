'use strict';

/**
 * Oxlint severity を Mamori severity へ変換する。
 * @param {string|undefined} severity Oxlint severity を表す。
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
 * Oxlint 診断の位置情報を返す。
 * @param {object} diagnostic Oxlint 診断を表す。
 * @returns {{line?: number, column?: number}} 行・列を返す。
 */
function resolveLocation(diagnostic) {
  const labels = Array.isArray(diagnostic.labels) ? diagnostic.labels : [];
  const firstLabel = labels[0];
  const span = firstLabel && firstLabel.span ? firstLabel.span : undefined;

  return {
    line: typeof span?.line === 'number' ? span.line : undefined,
    column: typeof span?.column === 'number' ? span.column : undefined,
  };
}

/**
 * Oxlint JSON から Issue 一覧を構築する。
 * @param {string} rawOutput Oxlint JSON 出力を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseOxlintJson(rawOutput) {
  if (typeof rawOutput !== 'string' || rawOutput.trim() === '') {
    return [];
  }

  let parsedOutput;
  try {
    parsedOutput = JSON.parse(rawOutput);
  } catch {
    return [];
  }

  const diagnostics = Array.isArray(parsedOutput?.diagnostics)
    ? parsedOutput.diagnostics
    : [];
  const issues = [];

  for (const diagnostic of diagnostics) {
    const location = resolveLocation(diagnostic || {});
    issues.push({
      tool: 'oxlint',
      ruleId: typeof diagnostic.code === 'string' ? diagnostic.code : undefined,
      message: typeof diagnostic.message === 'string' ? diagnostic.message : 'oxlint finding',
      severity: mapSeverity(typeof diagnostic.severity === 'string' ? diagnostic.severity : undefined),
      filePath: typeof diagnostic.filename === 'string' ? diagnostic.filename : undefined,
      line: location.line,
      column: location.column,
    });
  }

  return issues;
}

module.exports = {
  parseOxlintJson,
};