'use strict';

// パス操作を表す
const path = require('path');

// Knip issue type 一覧を表す
const KNIP_ISSUE_TYPES = [
  'files',
  'dependencies',
  'devDependencies',
  'optionalPeerDependencies',
  'unlisted',
  'unresolved',
  'exports',
  'nsExports',
  'types',
  'nsTypes',
  'enumMembers',
  'namespaceMembers',
  'duplicates',
  'catalog',
  'binaries',
];

/**
 * Knip が返した file を絶対パスへ正規化する。
 * @param {string|undefined} filePath Knip の file 値を表す。
 * @param {string|undefined} currentWorkingDirectory 実行時の作業ディレクトリを表す。
 * @returns {string|undefined} 正規化後の filePath を返す。
 */
function resolveAbsoluteFilePath(filePath, currentWorkingDirectory) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return undefined;
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(currentWorkingDirectory || process.cwd(), filePath);
}

/**
 * Knip issue ごとの filePath を返す。
 * @param {string|undefined} baseFilePath 行単位の filePath を表す。
 * @param {object} issue Knip issue を表す。
 * @param {string|undefined} currentWorkingDirectory 実行時の作業ディレクトリを表す。
 * @returns {string|undefined} filePath を返す。
 */
function resolveIssueFilePath(baseFilePath, issue, currentWorkingDirectory) {
  if (issue && typeof issue.path === 'string') {
    return resolveAbsoluteFilePath(issue.path, currentWorkingDirectory);
  }

  if (issue && typeof issue.file === 'string') {
    return resolveAbsoluteFilePath(issue.file, currentWorkingDirectory);
  }

  return resolveAbsoluteFilePath(baseFilePath, currentWorkingDirectory);
}

/**
 * Knip issue の表示名を返す。
 * @param {object} issue Knip issue を表す。
 * @returns {string|undefined} 表示名を返す。
 */
function resolveIssueLabel(issue) {
  if (!issue || typeof issue !== 'object') {
    return undefined;
  }

  return issue.name || issue.path || issue.symbol || issue.issue || undefined;
}

/**
 * Knip issue のメッセージを返す。
 * @param {string} issueType issue 種別を表す。
 * @param {object} issue Knip issue を表す。
 * @returns {string} Mamori issue 用メッセージを返す。
 */
function buildIssueMessage(issueType, issue) {
  const label = resolveIssueLabel(issue);
  if (label) {
    return `Knip reported ${issueType}: ${label}`;
  }

  return `Knip reported ${issueType}`;
}

/**
 * Knip JSON reporter 出力から Issue 一覧を構築する。
 * @param {string} rawOutput Knip JSON 出力を表す。
 * @param {string|undefined} currentWorkingDirectory 実行時の作業ディレクトリを表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseKnipJson(rawOutput, currentWorkingDirectory = undefined) {
  if (typeof rawOutput !== 'string' || rawOutput.trim() === '') {
    return [];
  }

  let parsedOutput;
  try {
    parsedOutput = JSON.parse(rawOutput);
  } catch {
    return [];
  }

  const issueRows = parsedOutput && Array.isArray(parsedOutput.issues)
    ? parsedOutput.issues
    : [];
  const issues = [];

  for (const issueRow of issueRows) {
    const baseFilePath = typeof issueRow.file === 'string' ? issueRow.file : undefined;
    for (const issueType of KNIP_ISSUE_TYPES) {
      const typedIssues = Array.isArray(issueRow[issueType]) ? issueRow[issueType] : [];
      for (const issue of typedIssues) {
        issues.push({
          tool: 'knip',
          ruleId: `knip/${issueType}`,
          message: buildIssueMessage(issueType, issue),
          severity: 'warning',
          filePath: resolveIssueFilePath(baseFilePath, issue, currentWorkingDirectory),
          line: typeof issue.line === 'number' ? issue.line : undefined,
          column: typeof issue.col === 'number' ? issue.col : undefined,
        });
      }
    }
  }

  return issues;
}

module.exports = {
  parseKnipJson,
};