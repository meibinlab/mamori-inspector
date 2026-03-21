'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

// Maven のビルドファイル名を表す
const MAVEN_BUILD_FILENAME = 'pom.xml';

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
 * 指定ディレクトリから最寄りの pom.xml を返す。
 * @param {string} startDirectory 探索開始ディレクトリを表す。
 * @param {string} stopDirectory 探索停止ディレクトリを表す。
 * @returns {string|undefined} 見つかった pom.xml の絶対パスを返す。
 */
function findNearestPomFile(startDirectory, stopDirectory) {
  const searchDirectories = buildSearchDirectories(startDirectory, stopDirectory);

  for (const searchDirectory of searchDirectories) {
    const candidatePath = path.join(searchDirectory, MAVEN_BUILD_FILENAME);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      return candidatePath;
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
 * ワークスペース配下の pom.xml 一覧を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {string[]} 見つかった pom.xml 一覧を返す。
 */
function findWorkspacePomFiles(currentWorkingDirectory) {
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

      if (entry.isFile() && entry.name === MAVEN_BUILD_FILENAME) {
        results.push(entryPath);
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

/**
 * XML テキストから最初に一致した値を返す。
 * @param {string} rawText 元の XML テキストを表す。
 * @param {RegExp} pattern 抽出に使う正規表現を表す。
 * @returns {string|undefined} 見つかった値を返す。
 */
function extractFirstMatch(rawText, pattern) {
  const match = rawText.match(pattern);
  return match && match[1] ? match[1].trim() : undefined;
}

/**
 * XML テキストから複数の一致値を返す。
 * @param {string} rawText 元の XML テキストを表す。
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
 * 指定プラグインの XML ブロック一覧を返す。
 * @param {string} rawPomText pom.xml の文字列内容を表す。
 * @param {string} artifactId ArtifactId を表す。
 * @returns {string[]} 見つかったプラグインブロック一覧を返す。
 */
function extractPluginBlocks(rawPomText, artifactId) {
  const pluginBlocks = [];
  const pluginPattern = /<plugin>([\s\S]*?)<\/plugin>/gu;

  for (const match of rawPomText.matchAll(pluginPattern)) {
    if (match[1] && match[1].includes(`<artifactId>${artifactId}</artifactId>`)) {
      pluginBlocks.push(match[1]);
    }
  }

  return pluginBlocks;
}

/**
 * Maven モジュールの build-definition を抽出する。
 * @param {string} buildFilePath pom.xml の絶対パスを表す。
 * @returns {{buildSystem: string, buildFile: string, moduleRoot: string, confidence: string, checkstyle: object, pmd: object, spotless: object, spotbugs: object, warnings: string[]}} 抽出結果を返す。
 */
function extractMavenBuildDefinition(buildFilePath) {
  const moduleRoot = path.dirname(buildFilePath);
  const warnings = [];
  const rawPomText = fs.readFileSync(buildFilePath, 'utf8');
  const checkstyleBlocks = extractPluginBlocks(rawPomText, 'maven-checkstyle-plugin');
  const pmdBlocks = extractPluginBlocks(rawPomText, 'maven-pmd-plugin');
  const spotlessBlocks = extractPluginBlocks(rawPomText, 'spotless-maven-plugin');
  const spotbugsBlocks = extractPluginBlocks(rawPomText, 'spotbugs-maven-plugin');
  const checkstyleConfig = extractFirstMatch(
    checkstyleBlocks.join('\n'),
    /<configLocation>([^<]+)<\/configLocation>/u,
  );
  const pmdRulesets = extractAllMatches(
    pmdBlocks.join('\n'),
    /<ruleset>([^<]+)<\/ruleset>/gu,
  );

  if (checkstyleBlocks.length > 0 && !checkstyleConfig) {
    warnings.push('maven-checkstyle-plugin was found but configLocation was not extracted');
  }
  if (pmdBlocks.length > 0 && pmdRulesets.length === 0) {
    warnings.push('maven-pmd-plugin was found but ruleset was not extracted');
  }

  return {
    buildSystem: 'maven',
    buildFile: buildFilePath,
    moduleRoot,
    confidence: 'high',
    checkstyle: {
      configured: checkstyleBlocks.length > 0,
      configLocation: checkstyleConfig,
    },
    pmd: {
      configured: pmdBlocks.length > 0,
      rulesets: pmdRulesets,
    },
    spotless: {
      configured: spotlessBlocks.length > 0,
    },
    spotbugs: {
      configured: spotbugsBlocks.length > 0,
    },
    warnings,
  };
}

module.exports = {
  extractMavenBuildDefinition,
  findNearestPomFile,
  findWorkspacePomFiles,
};