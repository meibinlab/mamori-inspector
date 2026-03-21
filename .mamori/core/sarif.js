'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

/**
 * 重要度を SARIF level へ変換する。
 * @param {string} severity 重要度を表す。
 * @returns {'error'|'warning'|'note'} SARIF level を返す。
 */
function mapSeverity(severity) {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
    default:
      return 'note';
  }
}

/**
 * Issue から SARIF 位置情報を構築する。
 * @param {object} issue Issue を表す。
 * @returns {object|undefined} SARIF 位置情報を返す。
 */
function buildLocation(issue) {
  if (!issue.filePath) {
    return undefined;
  }

  const location = {
    physicalLocation: {
      artifactLocation: {
        uri: issue.filePath,
      },
    },
  };

  if (issue.line && issue.line > 0) {
    location.physicalLocation.region = {
      startLine: issue.line,
      startColumn: issue.column && issue.column > 0 ? issue.column : undefined,
    };
  }

  return location;
}

/**
 * ツール別の rule 定義一覧を構築する。
 * @param {object[]} issues Issue 一覧を表す。
 * @returns {object[]} SARIF rule 一覧を返す。
 */
function buildRules(issues) {
  const seen = new Set();
  const rules = [];

  for (const issue of issues) {
    if (!issue.ruleId || seen.has(issue.ruleId)) {
      continue;
    }
    seen.add(issue.ruleId);
    rules.push({ id: issue.ruleId });
  }

  return rules;
}

/**
 * 単一ツール向けの SARIF run を構築する。
 * @param {string} toolName ツール名を表す。
 * @param {object[]} issues Issue 一覧を表す。
 * @returns {object} SARIF run を返す。
 */
function buildRun(toolName, issues) {
  return {
    tool: {
      driver: {
        name: toolName,
        rules: buildRules(issues),
      },
    },
    results: issues.map((issue) => {
      const result = {
        ruleId: issue.ruleId,
        level: mapSeverity(issue.severity),
        message: {
          text: issue.message,
        },
      };
      const location = buildLocation(issue);
      if (location) {
        result.locations = [location];
      }
      return result;
    }),
  };
}

/**
 * Issue 一覧から combined SARIF を構築する。
 * @param {object[]} issues Issue 一覧を表す。
 * @returns {{version: string, $schema: string, runs: object[]}} SARIF ログを返す。
 */
function buildCombinedSarif(issues) {
  const groupedIssues = new Map();

  for (const issue of issues) {
    const toolName = issue.tool || 'mamori';
    if (!groupedIssues.has(toolName)) {
      groupedIssues.set(toolName, []);
    }
    groupedIssues.get(toolName).push(issue);
  }

  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [...groupedIssues.entries()].map(([toolName, toolIssues]) => buildRun(toolName, toolIssues)),
  };
}

/**
 * SARIF をファイルへ保存する。
 * @param {object} sarifLog SARIF ログを表す。
 * @param {string} outputPath 出力先パスを表す。
 * @returns {string} 保存先の絶対パスを返す。
 */
function writeSarifFile(sarifLog, outputPath) {
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(sarifLog, null, 2)}\n`, 'utf8');
  return resolvedPath;
}

module.exports = {
  buildCombinedSarif,
  writeSarifFile,
};