'use strict';

// パス操作を表す
const path = require('path');

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
 * Stylelint 出力のファイルパスを元ファイルへ逆写像する。
 * @param {string|undefined} filePath Stylelint が返したファイルパスを表す。
 * @param {Record<string, string>|undefined} filePathMappings 一時ファイルから元ファイルへの対応表を表す。
 * @returns {string|undefined} 逆写像後のファイルパスを返す。
 */
function resolveMappedFilePath(filePath, filePathMappings) {
  if (typeof filePath !== 'string' || !filePathMappings) {
    return filePath;
  }

  const resolvedFilePath = path.resolve(filePath);
  return filePathMappings[filePath] || filePathMappings[resolvedFilePath] || filePath;
}

/**
 * Stylelint JSON から Issue 一覧を構築する。
 * @param {string} rawOutput Stylelint JSON 出力を表す。
 * @param {Record<string, string>=} filePathMappings 一時ファイルから元ファイルへの対応表を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseStylelintJson(rawOutput, filePathMappings = undefined) {
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
        filePath: resolveMappedFilePath(
          typeof result.source === 'string' ? result.source : undefined,
          filePathMappings,
        ),
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