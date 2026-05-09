'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');
// ホームディレクトリ取得を表す
const os = require('os');

// Maven のビルドファイル名を表す
const MAVEN_BUILD_FILENAME = 'pom.xml';

// 親 POM 探索の最大深度を表す（循環参照防止）
const MAX_PARENT_POM_DEPTH = 10;

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
 * pom.xml から親 POM の座標と relativePath を抽出する。
 * @param {string} rawPomText pom.xml の文字列内容を表す。
 * @returns {{groupId: string, artifactId: string, version: string, relativePath: string|undefined}|undefined} 親 POM 情報を返す。
 */
function extractParentPomInfo(rawPomText) {
  const parentMatch = rawPomText.match(/<parent>([\s\S]*?)<\/parent>/u);
  if (!parentMatch || !parentMatch[1]) {
    return undefined;
  }

  const parentBlock = parentMatch[1];
  const groupId = extractFirstMatch(parentBlock, /<groupId>([^<]+)<\/groupId>/u);
  const artifactId = extractFirstMatch(parentBlock, /<artifactId>([^<]+)<\/artifactId>/u);
  const version = extractFirstMatch(parentBlock, /<version>([^<]+)<\/version>/u);
  const relativePath = extractFirstMatch(parentBlock, /<relativePath>([^<]*)<\/relativePath>/u);

  if (!groupId || !artifactId || !version) {
    return undefined;
  }

  return { groupId, artifactId, version, relativePath };
}

/**
 * ローカル Maven リポジトリ内の POM ファイルパスを返す。
 * @param {string} groupId グループ ID を表す。
 * @param {string} artifactId アーティファクト ID を表す。
 * @param {string} version バージョンを表す。
 * @returns {string} POM ファイルパスを返す。
 */
function resolveLocalRepositoryPomPath(groupId, artifactId, version) {
  const groupPath = groupId.split('.').join(path.sep);
  return path.join(
    os.homedir(),
    '.m2',
    'repository',
    groupPath,
    artifactId,
    version,
    `${artifactId}-${version}.pom`,
  );
}

/**
 * 親 POM のファイルパスを解決する。
 * Lemminx と同じ順序で探索する:
 * 1. <relativePath> が明示されていればそのパス
 * 2. 省略時は ../pom.xml
 * 3. ~/.m2/repository 内の POM
 * @param {string} childPomPath 子 POM のファイルパスを表す。
 * @param {{groupId: string, artifactId: string, version: string, relativePath: string|undefined}} parentInfo 親 POM 情報を表す。
 * @returns {string|undefined} 見つかった親 POM のファイルパスを返す。
 */
function resolveParentPomPath(childPomPath, parentInfo) {
  const childDir = path.dirname(childPomPath);

  // relativePath が空文字列の場合はファイルシステム探索をスキップする
  if (parentInfo.relativePath !== undefined && parentInfo.relativePath !== '') {
    const candidate = path.resolve(childDir, parentInfo.relativePath);
    // ディレクトリが指定された場合は pom.xml を補完する
    const resolvedCandidate = candidate.endsWith('.xml')
      ? candidate
      : path.join(candidate, MAVEN_BUILD_FILENAME);
    if (fs.existsSync(resolvedCandidate) && fs.statSync(resolvedCandidate).isFile()) {
      return resolvedCandidate;
    }
    return undefined;
  }

  // relativePath 未指定時は ../pom.xml を試みる
  if (parentInfo.relativePath === undefined) {
    const defaultCandidate = path.join(childDir, '..', MAVEN_BUILD_FILENAME);
    if (fs.existsSync(defaultCandidate) && fs.statSync(defaultCandidate).isFile()) {
      return defaultCandidate;
    }
  }

  // ~/.m2/repository にフォールバックする
  const localRepoPomPath = resolveLocalRepositoryPomPath(
    parentInfo.groupId,
    parentInfo.artifactId,
    parentInfo.version,
  );
  if (fs.existsSync(localRepoPomPath) && fs.statSync(localRepoPomPath).isFile()) {
    return localRepoPomPath;
  }

  return undefined;
}

/**
 * POM テキストからプラグイン設定を抽出する。
 * @param {string} rawPomText pom.xml の文字列内容を表す。
 * @returns {{checkstyleBlocks: string[], pmdBlocks: string[], spotlessBlocks: string[], spotbugsBlocks: string[]}} プラグインブロック一覧を返す。
 */
function extractAllPluginBlocks(rawPomText) {
  return {
    checkstyleBlocks: extractPluginBlocks(rawPomText, 'maven-checkstyle-plugin'),
    pmdBlocks: extractPluginBlocks(rawPomText, 'maven-pmd-plugin'),
    spotlessBlocks: extractPluginBlocks(rawPomText, 'spotless-maven-plugin'),
    spotbugsBlocks: extractPluginBlocks(rawPomText, 'spotbugs-maven-plugin'),
  };
}

/**
 * 先祖 POM を遡って不足しているプラグインブロックを補完する。
 * @param {string} pomFilePath 起点となる POM のファイルパスを表す。
 * @param {{checkstyleBlocks: string[], pmdBlocks: string[], spotlessBlocks: string[], spotbugsBlocks: string[]}} accumulated 現在蓄積済みのプラグインブロックを表す。
 * @param {Set<string>} visited 訪問済み POM パスを表す。
 * @param {number} depth 現在の探索深度を表す。
 * @returns {{checkstyleBlocks: string[], pmdBlocks: string[], spotlessBlocks: string[], spotbugsBlocks: string[]}} 補完後のプラグインブロックを返す。
 */
function mergeParentPluginBlocks(pomFilePath, accumulated, visited, depth) {
  if (depth > MAX_PARENT_POM_DEPTH) {
    return accumulated;
  }

  let rawPomText;
  try {
    rawPomText = fs.readFileSync(pomFilePath, 'utf8');
  } catch {
    return accumulated;
  }

  const parentInfo = extractParentPomInfo(rawPomText);
  if (!parentInfo) {
    return accumulated;
  }

  const parentPomPath = resolveParentPomPath(pomFilePath, parentInfo);
  if (!parentPomPath) {
    return accumulated;
  }

  const resolvedParentPath = path.resolve(parentPomPath);
  if (visited.has(resolvedParentPath)) {
    return accumulated;
  }
  visited.add(resolvedParentPath);

  let parentRawPomText;
  try {
    parentRawPomText = fs.readFileSync(resolvedParentPath, 'utf8');
  } catch {
    return accumulated;
  }

  const parentBlocks = extractAllPluginBlocks(parentRawPomText);
  const merged = {
    checkstyleBlocks: accumulated.checkstyleBlocks.length > 0
      ? accumulated.checkstyleBlocks
      : parentBlocks.checkstyleBlocks,
    pmdBlocks: accumulated.pmdBlocks.length > 0
      ? accumulated.pmdBlocks
      : parentBlocks.pmdBlocks,
    spotlessBlocks: accumulated.spotlessBlocks.length > 0
      ? accumulated.spotlessBlocks
      : parentBlocks.spotlessBlocks,
    spotbugsBlocks: accumulated.spotbugsBlocks.length > 0
      ? accumulated.spotbugsBlocks
      : parentBlocks.spotbugsBlocks,
  };

  const allResolved = merged.checkstyleBlocks.length > 0
    && merged.pmdBlocks.length > 0
    && merged.spotlessBlocks.length > 0
    && merged.spotbugsBlocks.length > 0;

  if (allResolved) {
    return merged;
  }

  return mergeParentPluginBlocks(resolvedParentPath, merged, visited, depth + 1);
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

  const ownBlocks = extractAllPluginBlocks(rawPomText);
  const visited = new Set([path.resolve(buildFilePath)]);
  const { checkstyleBlocks, pmdBlocks, spotlessBlocks, spotbugsBlocks } = mergeParentPluginBlocks(
    buildFilePath,
    ownBlocks,
    visited,
    1,
  );

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
