'use strict';

// Maven の既定バージョンを表す
const DEFAULT_MAVEN_VERSION = '3.9.11';
// Gradle の既定バージョンを表す
const DEFAULT_GRADLE_VERSION = '8.14.4';
// Semgrep の既定バージョンを表す
const DEFAULT_SEMGREP_VERSION = '1.151.0';

// Node 系ツールのパッケージ定義一覧を表す
const NODE_TOOL_PACKAGES = {
  prettier: {
    packageName: 'prettier',
  },
  eslint: {
    packageName: 'eslint',
  },
  oxlint: {
    packageName: 'oxlint',
  },
  tsc: {
    packageName: 'typescript',
  },
  stylelint: {
    packageName: 'stylelint',
  },
  htmlhint: {
    packageName: 'htmlhint',
  },
  'html-validate': {
    packageName: 'html-validate',
  },
};

/**
 * Maven 配布物の定義を返す。
 * @param {NodeJS.ProcessEnv=} env 環境変数を表す。
 * @returns {{tool: string, version: string, archiveType: string, executableRelativePaths: string[], sourceUrl: string}} Maven 定義を返す。
 */
function getMavenDefinition(env = process.env) {
  const version = env.MAMORI_TOOL_MAVEN_VERSION || DEFAULT_MAVEN_VERSION;
  return {
    tool: 'maven',
    version,
    archiveType: 'zip',
    executableRelativePaths: process.platform === 'win32'
      ? ['bin/mvn.cmd', 'bin/mvn.bat']
      : ['bin/mvn'],
    sourceUrl: env.MAMORI_TOOL_MAVEN_SOURCE_URL
      || `https://archive.apache.org/dist/maven/maven-3/${version}/binaries/apache-maven-${version}-bin.zip`,
  };
}

/**
 * Gradle 配布物の定義を返す。
 * @param {NodeJS.ProcessEnv=} env 環境変数を表す。
 * @returns {{tool: string, version: string, archiveType: string, executableRelativePaths: string[], sourceUrl: string}} Gradle 定義を返す。
 */
function getGradleDefinition(env = process.env) {
  const version = env.MAMORI_TOOL_GRADLE_VERSION || DEFAULT_GRADLE_VERSION;
  return {
    tool: 'gradle',
    version,
    archiveType: 'zip',
    executableRelativePaths: process.platform === 'win32'
      ? ['bin/gradle.bat', 'bin/gradle.cmd']
      : ['bin/gradle'],
    sourceUrl: env.MAMORI_TOOL_GRADLE_SOURCE_URL
      || `https://services.gradle.org/distributions/gradle-${version}-bin.zip`,
  };
}

/**
 * Semgrep の Python パッケージ定義を返す。
 * @param {NodeJS.ProcessEnv=} env 環境変数を表す。
 * @returns {{tool: string, version: string, packageName: string}} Semgrep 定義を返す。
 */
function getSemgrepDefinition(env = process.env) {
  return {
    tool: 'semgrep',
    version: env.MAMORI_TOOL_SEMGREP_VERSION || DEFAULT_SEMGREP_VERSION,
    packageName: 'semgrep',
  };
}

module.exports = {
  NODE_TOOL_PACKAGES,
  getGradleDefinition,
  getMavenDefinition,
  getSemgrepDefinition,
};