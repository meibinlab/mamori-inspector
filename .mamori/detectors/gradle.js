'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

// Gradle のビルドファイル名一覧を表す
const GRADLE_BUILD_FILENAMES = ['build.gradle.kts', 'build.gradle'];

/**
 * ディレクトリ階層を上位へたどる。
 * @param {string} startDirectory 探索開始ディレクトリを表す。
 * @param {string} stopDirectory 探索停止ディレクトリを表す。
 * @returns {string[]} 探索対象ディレクトリ一覧を返す。
 */
function buildSearchDirectories(startDirectory, stopDirectory) {
  const directories = [];
  let currentDirectory = path.resolve(startDirectory);
  const resolvedStopDirectory = path.resolve(stopDirectory);

  while (true) {
    directories.push(currentDirectory);
    if (currentDirectory === resolvedStopDirectory) {
      break;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  return directories;
}

/**
 * 最寄りの Gradle ビルドファイルを返す。
 * @param {string} startDirectory 探索開始ディレクトリを表す。
 * @param {string} stopDirectory 探索停止ディレクトリを表す。
 * @returns {string|undefined} 見つかったビルドファイルの絶対パスを返す。
 */
function findNearestGradleBuildFile(startDirectory, stopDirectory) {
  const searchDirectories = buildSearchDirectories(startDirectory, stopDirectory);

  for (const searchDirectory of searchDirectories) {
    for (const buildFilename of GRADLE_BUILD_FILENAMES) {
      const candidatePath = path.join(searchDirectory, buildFilename);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        return candidatePath;
      }
    }
  }

  return undefined;
}

/**
 * 除外対象ディレクトリか判定する。
 * @param {string} directoryName ディレクトリ名を表す。
 * @returns {boolean} 除外対象なら true を返す。
 */
function isExcludedDirectory(directoryName) {
  return [
    '.git',
    '.gradle',
    '.mamori',
    'build',
    'dist',
    'node_modules',
    'out',
    'target',
  ].includes(directoryName);
}

/**
 * ワークスペース配下の Gradle ビルドファイル一覧を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {string[]} 見つかったビルドファイル一覧を返す。
 */
function findWorkspaceGradleBuildFiles(currentWorkingDirectory) {
  const results = [];
  const pendingDirectories = [path.resolve(currentWorkingDirectory)];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!isExcludedDirectory(entry.name)) {
          pendingDirectories.push(entryPath);
        }
        continue;
      }

      if (entry.isFile() && GRADLE_BUILD_FILENAMES.includes(entry.name)) {
        results.push(entryPath);
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

/**
 * 最初に一致した値を返す。
 * @param {string} rawText 元の文字列を表す。
 * @param {RegExp} pattern 抽出に使う正規表現を表す。
 * @returns {string|undefined} 見つかった値を返す。
 */
function extractFirstMatch(rawText, pattern) {
  const match = rawText.match(pattern);
  return match && match[1] ? match[1].trim() : undefined;
}

/**
 * 複数の一致値を返す。
 * @param {string} rawText 元の文字列を表す。
 * @param {RegExp} pattern 抽出に使う正規表現を表す。
 * @returns {string[]} 見つかった値一覧を返す。
 */
function extractAllMatches(rawText, pattern) {
  const values = [];

  for (const match of rawText.matchAll(pattern)) {
    if (match[1]) {
      values.push(match[1].trim());
    }
  }

  return values;
}

/**
 * 正規表現用に文字列をエスケープする。
 * @param {string} value 元の文字列を表す。
 * @returns {string} エスケープ済み文字列を返す。
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Gradle plugin ID の有無を判定する。
 * @param {string} rawText 元の文字列を表す。
 * @param {string} pluginId plugin ID を表す。
 * @returns {boolean} plugin が見つかった場合は true を返す。
 */
function hasGradlePlugin(rawText, pluginId) {
  const escapedPluginId = escapeRegExp(pluginId);
  const functionStylePattern = new RegExp(`id\\s*\\(\\s*['"]${escapedPluginId}['"]\\s*\\)`, 'u');
  const groovyStylePattern = new RegExp(`id\\s+['"]${escapedPluginId}['"]`, 'u');
  return functionStylePattern.test(rawText) || groovyStylePattern.test(rawText);
}

/**
 * Gradle モジュールの build-definition を抽出する。
 * @param {string} buildFilePath Gradle ビルドファイルの絶対パスを表す。
 * @returns {{buildSystem: string, buildFile: string, moduleRoot: string, confidence: string, checkstyle: object, pmd: object, spotless: object, spotbugs: object, warnings: string[]}} 抽出結果を返す。
 */
function extractGradleBuildDefinition(buildFilePath) {
  const moduleRoot = path.dirname(buildFilePath);
  const warnings = [];
  const rawBuildText = fs.readFileSync(buildFilePath, 'utf8');
  const checkstyleConfig = extractFirstMatch(
    rawBuildText,
    /checkstyle\s*\{[\s\S]*?configFile\s*=\s*file\(['"]([^'"]+)['"]\)/u,
  ) || extractFirstMatch(
    rawBuildText,
    /checkstyle\s*\{[\s\S]*?configFile\s*=\s*layout\.projectDirectory\.file\(['"]([^'"]+)['"]\)/u,
  );
  const pmdRulesets = extractAllMatches(
    rawBuildText,
    /ruleSetFiles\s*=\s*files\(([^)]+)\)/gu,
  ).flatMap((value) => value.split(','))
    .map((value) => value.replace(/file\(|['"\s)]/gu, ''))
    .filter((value) => Boolean(value));
  const spotbugsExcludeFilter = extractFirstMatch(
    rawBuildText,
    /spotbugs\s*\{[\s\S]*?excludeFilter\s*=\s*file\(['"]([^'"]+)['"]\)/u,
  ) || extractFirstMatch(
    rawBuildText,
    /spotbugs\s*\{[\s\S]*?excludeFilter\s*=\s*layout\.projectDirectory\.file\(['"]([^'"]+)['"]\)/u,
  );
  const hasCheckstyle = /checkstyle\s*\{/u.test(rawBuildText) || hasGradlePlugin(rawBuildText, 'checkstyle');
  const hasPmd = /pmd\s*\{/u.test(rawBuildText) || hasGradlePlugin(rawBuildText, 'pmd');
  const hasSpotless = /spotless\s*\{/u.test(rawBuildText) || hasGradlePlugin(rawBuildText, 'com.diffplug.spotless');
  const hasSpotbugs = /spotbugs\s*\{/u.test(rawBuildText) || hasGradlePlugin(rawBuildText, 'com.github.spotbugs');

  if (hasCheckstyle && !checkstyleConfig) {
    warnings.push('gradle checkstyle configuration was found but configFile was not extracted');
  }
  if (hasPmd && pmdRulesets.length === 0) {
    warnings.push('gradle pmd configuration was found but ruleSetFiles was not extracted');
  }

  return {
    buildSystem: 'gradle',
    buildFile: buildFilePath,
    moduleRoot,
    confidence: 'medium',
    checkstyle: {
      configured: hasCheckstyle,
      configLocation: checkstyleConfig,
    },
    pmd: {
      configured: hasPmd,
      rulesets: pmdRulesets,
    },
    spotless: {
      configured: hasSpotless,
    },
    spotbugs: {
      configured: hasSpotbugs,
      excludeFilter: spotbugsExcludeFilter,
    },
    warnings,
  };
}

module.exports = {
  extractGradleBuildDefinition,
  findNearestGradleBuildFile,
  findWorkspaceGradleBuildFiles,
};