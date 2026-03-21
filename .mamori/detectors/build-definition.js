'use strict';

// パス操作を表す
const path = require('path');
// Maven 抽出器を表す
const mavenDetector = require('./maven');
// Gradle 抽出器を表す
const gradleDetector = require('./gradle');

/**
 * 重複しない文字列一覧を返す。
 * @param {string[]} values 元の文字列一覧を表す。
 * @returns {string[]} 重複を除いた文字列一覧を返す。
 */
function unique(values) {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

/**
 * ビルドファイル一覧から build-definition 一覧を返す。
 * @param {string[]} buildFiles ビルドファイル一覧を表す。
 * @returns {object[]} build-definition 一覧を返す。
 */
function buildDefinitionsFromFiles(buildFiles) {
  return buildFiles.map((buildFilePath) => {
    if (buildFilePath.endsWith('pom.xml')) {
      return mavenDetector.extractMavenBuildDefinition(buildFilePath);
    }
    return gradleDetector.extractGradleBuildDefinition(buildFilePath);
  });
}

/**
 * file scope 向けの build-definition 一覧を返す。
 * @param {string[]} startDirectories 探索開始ディレクトリ一覧を表す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {object[]} build-definition 一覧を返す。
 */
function resolveFileScopedBuildDefinitions(startDirectories, currentWorkingDirectory) {
  const buildFiles = [];

  for (const startDirectory of startDirectories) {
    const nearestPomFile = mavenDetector.findNearestPomFile(startDirectory, currentWorkingDirectory);
    const nearestGradleFile = gradleDetector.findNearestGradleBuildFile(startDirectory, currentWorkingDirectory);

    if (nearestPomFile) {
      buildFiles.push(nearestPomFile);
    }
    if (nearestGradleFile) {
      buildFiles.push(nearestGradleFile);
    }
  }

  return buildDefinitionsFromFiles(unique(buildFiles));
}

/**
 * workspace scope 向けの build-definition 一覧を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {object[]} build-definition 一覧を返す。
 */
function resolveWorkspaceBuildDefinitions(currentWorkingDirectory) {
  const mavenBuildFiles = mavenDetector.findWorkspacePomFiles(currentWorkingDirectory);
  const gradleBuildFiles = gradleDetector.findWorkspaceGradleBuildFiles(currentWorkingDirectory);

  return buildDefinitionsFromFiles(unique([...mavenBuildFiles, ...gradleBuildFiles]));
}

/**
 * build-definition の抽出結果を返す。
 * @param {string[]} startDirectories 探索開始ディレクトリ一覧を表す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {string} scope 実行スコープを表す。
 * @returns {{modules: object[], source: string}} 抽出結果を返す。
 */
function resolveBuildDefinitions(startDirectories, currentWorkingDirectory, scope) {
  const modules = scope === 'file'
    ? resolveFileScopedBuildDefinitions(startDirectories, currentWorkingDirectory)
    : resolveWorkspaceBuildDefinitions(currentWorkingDirectory);

  return {
    source: modules.length > 0 ? 'buildDefinition' : 'unresolved',
    modules,
  };
}

module.exports = {
  resolveBuildDefinitions,
};