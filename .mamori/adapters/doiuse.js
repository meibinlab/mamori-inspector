'use strict';

// パス操作を表す
const path = require('path');

/**
 * doiuse 出力のファイルパスを元ファイルへ逆写像する。
 * @param {string|undefined} filePath doiuse が返したファイルパスを表す。
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
 * doiuse NDJSON から Issue 一覧を構築する。
 * @param {string} rawOutput doiuse の JSON 出力を表す。
 * @param {Record<string, string>=} filePathMappings 一時ファイルから元ファイルへの対応表を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseDoiuseJsonLines(rawOutput, filePathMappings = undefined) {
  if (typeof rawOutput !== 'string' || rawOutput.trim() === '') {
    return [];
  }

  const issues = [];
  const lines = rawOutput
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => Boolean(line));

  for (const line of lines) {
    let parsedOutput;
    try {
      parsedOutput = JSON.parse(line);
    } catch {
      continue;
    }

    issues.push({
      tool: 'doiuse',
      ruleId: typeof parsedOutput.feature === 'string' ? parsedOutput.feature : undefined,
      message: typeof parsedOutput.message === 'string' ? parsedOutput.message : 'doiuse finding',
      severity: 'warning',
      filePath: resolveMappedFilePath(
        parsedOutput.usage
          && Array.isArray(parsedOutput.usage.inputs)
          && parsedOutput.usage.inputs[0]
          && typeof parsedOutput.usage.inputs[0].file === 'string'
          ? parsedOutput.usage.inputs[0].file
          : undefined,
        filePathMappings,
      ),
      line: parsedOutput.usage
        && parsedOutput.usage.source
        && parsedOutput.usage.source.start
        && typeof parsedOutput.usage.source.start.line === 'number'
        ? parsedOutput.usage.source.start.line
        : undefined,
      column: parsedOutput.usage
        && parsedOutput.usage.source
        && parsedOutput.usage.source.start
        && typeof parsedOutput.usage.source.start.column === 'number'
        ? parsedOutput.usage.source.start.column
        : undefined,
    });
  }

  return issues;
}

module.exports = {
  parseDoiuseJsonLines,
};