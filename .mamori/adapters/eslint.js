'use strict';

// パス操作を表す
const path = require('path');

/**
 * ESLint severity を Mamori severity へ変換する。
 * @param {number|undefined} severity ESLint severity を表す。
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
 * ESLint 出力のファイルパスを元ファイルへ逆写像する。
 * @param {string|undefined} filePath ESLint が返したファイルパスを表す。
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
 * ESLint JSON から Issue 一覧を構築する。
 * @param {string} rawOutput ESLint JSON 出力を表す。
 * @param {Record<string, string>=} filePathMappings 一時ファイルから元ファイルへの対応表を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseEslintJson(rawOutput, filePathMappings = undefined) {
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
        tool: 'eslint',
        ruleId: typeof message.ruleId === 'string' ? message.ruleId : undefined,
        message: typeof message.message === 'string' ? message.message : 'eslint finding',
        severity: mapSeverity(message.severity),
        filePath: resolveMappedFilePath(
          typeof result.filePath === 'string' ? result.filePath : undefined,
          filePathMappings,
        ),
        line: typeof message.line === 'number' ? message.line : undefined,
        column: typeof message.column === 'number' ? message.column : undefined,
      });
    }
  }

  return issues;
}

module.exports = {
  parseEslintJson,
};