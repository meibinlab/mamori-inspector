'use strict';

// TypeScript 診断コードの判定パターンを表す
const TSC_LOCATION_PATTERN = /^(?<filePath>.+)\((?<line>\d+),(?<column>\d+)\):\s+(?<severity>error|warning)\s+(?<code>TS\d+):\s+(?<message>.+)$/u;
// 位置情報を持たない TypeScript 診断の判定パターンを表す
const TSC_GLOBAL_PATTERN = /^(?<severity>error|warning)\s+(?<code>TS\d+):\s+(?<message>.+)$/u;

/**
 * TypeScript severity を Mamori severity へ変換する。
 * @param {string|undefined} severity TypeScript severity を表す。
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
 * TypeScript CLI 出力から Issue 一覧を構築する。
 * @param {string} rawOutput TypeScript CLI 出力を表す。
 * @param {string|undefined} configPath 解決済み tsconfig パスを表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseTscOutput(rawOutput, configPath = undefined) {
  if (typeof rawOutput !== 'string' || rawOutput.trim() === '') {
    return [];
  }

  const issues = [];
  const lines = rawOutput
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => Boolean(line));

  for (const line of lines) {
    const locationMatch = line.match(TSC_LOCATION_PATTERN);
    if (locationMatch && locationMatch.groups) {
      issues.push({
        tool: 'tsc',
        ruleId: locationMatch.groups.code,
        message: locationMatch.groups.message,
        severity: mapSeverity(locationMatch.groups.severity),
        filePath: locationMatch.groups.filePath,
        line: Number(locationMatch.groups.line),
        column: Number(locationMatch.groups.column),
      });
      continue;
    }

    const globalMatch = line.match(TSC_GLOBAL_PATTERN);
    if (globalMatch && globalMatch.groups) {
      issues.push({
        tool: 'tsc',
        ruleId: globalMatch.groups.code,
        message: globalMatch.groups.message,
        severity: mapSeverity(globalMatch.groups.severity),
        filePath: configPath,
      });
    }
  }

  return issues;
}

module.exports = {
  parseTscOutput,
};