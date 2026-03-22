'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');
// Checkstyle adapter を表す
const checkstyleAdapter = require('../adapters/checkstyle');
// CPD adapter を表す
const cpdAdapter = require('../adapters/cpd');
// ESLint adapter を表す
const eslintAdapter = require('../adapters/eslint');
// htmlhint adapter を表す
const htmlhintAdapter = require('../adapters/htmlhint');
// PMD adapter を表す
const pmdAdapter = require('../adapters/pmd');
// SpotBugs adapter を表す
const spotbugsAdapter = require('../adapters/spotbugs');
// Stylelint adapter を表す
const stylelintAdapter = require('../adapters/stylelint');
// Semgrep adapter を表す
const semgrepAdapter = require('../adapters/semgrep');
// コマンド実行器を表す
const { execCommand } = require('../tools/exec');

/**
 * 実行結果の初期値を返す。
 * @returns {{issues: object[], warnings: string[], commandResults: object[], exitCode: number}} 初期結果を返す。
 */
function createInitialRunResult() {
  return {
    issues: [],
    warnings: [],
    commandResults: [],
    exitCode: 0,
  };
}

/**
 * ツール実行結果から Issue 一覧を抽出する。
 * @param {{tool: string, stdout?: string}} commandResult 実行結果を表す。
 * @returns {Array<object>} Issue 一覧を返す。
 */
function extractIssues(commandResult) {
  if (commandResult.tool === 'checkstyle') {
    return checkstyleAdapter.parseCheckstyleXml(commandResult.stdout || '');
  }

  if (commandResult.tool === 'pmd') {
    return pmdAdapter.parsePmdXml(commandResult.stdout || '');
  }

  if (commandResult.tool === 'cpd') {
    return cpdAdapter.parseCpdXml(commandResult.stdout || '');
  }

  if (commandResult.tool === 'spotbugs') {
    return spotbugsAdapter.parseSpotbugsXml(commandResult.stdout || '');
  }

  if (commandResult.tool === 'semgrep') {
    return semgrepAdapter.parseSemgrepSarif(commandResult.stdout || '');
  }

  if (commandResult.tool === 'eslint') {
    return eslintAdapter.parseEslintJson(commandResult.stdout || '');
  }

  if (commandResult.tool === 'stylelint') {
    return stylelintAdapter.parseStylelintJson(commandResult.stdout || '');
  }

  if (commandResult.tool === 'htmlhint') {
    return htmlhintAdapter.parseHtmlhintJson(commandResult.stdout || '');
  }

  return [];
}

/**
 * command plan に含まれる警告一覧を収集する。
 * @param {{modules?: object[]}} commandPlan コマンド計画を表す。
 * @returns {string[]} 警告一覧を返す。
 */
function collectPlanWarnings(commandPlan) {
  const modules = Array.isArray(commandPlan.modules)
    ? commandPlan.modules
    : [];

  return modules.flatMap((modulePlan) => (
    Array.isArray(modulePlan.warnings) ? modulePlan.warnings : []
  ));
}

/**
 * コマンド未実行エントリを返す。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {object} commandEntry コマンド計画を表す。
 * @returns {{moduleRoot: string, tool: string, status: string, reason: string}} 実行結果を返す。
 */
function buildSkippedCommandResult(moduleRoot, commandEntry) {
  return {
    moduleRoot,
    tool: commandEntry.tool,
    phase: commandEntry.phase,
    status: 'skipped',
    reason: commandEntry.reason || 'disabled',
  };
}

/**
 * pre-commit の再ステージ対象ファイル一覧を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {string[]|undefined} files 対象ファイル一覧を表す。
 * @returns {string[]} Git add に渡す相対パス一覧を返す。
 */
function resolveRestageFiles(currentWorkingDirectory, files) {
  if (!Array.isArray(files)) {
    return [];
  }

  const resolvedWorkingDirectory = path.resolve(currentWorkingDirectory);
  return files
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => path.relative(resolvedWorkingDirectory, filePath))
    .filter((relativePath) => Boolean(relativePath))
    .filter((relativePath) => relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`));
}

/**
 * formatter が成功したか判定する。
 * @param {object[]} commandResults コマンド実行結果一覧を表す。
 * @returns {boolean} formatter が成功していれば true を返す。
 */
function hasSuccessfulFormatter(commandResults) {
  return commandResults.some((commandResult) => (
    commandResult.phase === 'formatter' && commandResult.status === 'ok'
  ));
}

/**
 * pre-commit の整形結果を Git index へ再ステージする。
 * @param {{cwd?: string, files?: string[]}} resolution 解決済み設定を表す。
 * @param {(command: string, args: string[], options?: object) => Promise<{exitCode: number, stdout: string, stderr: string}>} executor 実行器を表す。
 * @returns {Promise<string|undefined>} 警告メッセージがある場合は返す。
 */
async function restageFormattedFiles(resolution, executor) {
  const currentWorkingDirectory = resolution.cwd || process.cwd();
  const restageFiles = resolveRestageFiles(currentWorkingDirectory, resolution.files);

  if (restageFiles.length === 0) {
    return undefined;
  }

  try {
    const result = await executor('git', ['add', '--', ...restageFiles], {
      cwd: currentWorkingDirectory,
      env: process.env,
      timeoutMs: 30000,
    });

    if (result.exitCode !== 0) {
      return result.stderr.trim() || 'git add failed during precommit restage';
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return undefined;
}

/**
 * コマンド起動失敗に相当する標準エラー出力か判定する。
 * @param {string} stderr 標準エラー出力を表す。
 * @returns {boolean} 起動失敗相当なら true を返す。
 */
function isCommandStartFailure(stderr) {
  const normalized = typeof stderr === 'string'
    ? stderr.toLowerCase()
    : '';

  return normalized.includes('is not recognized as an internal or external command')
    || normalized.includes('not found');
}

/**
 * コマンド候補の存在有無を返す。
 * @param {string} candidatePath 確認対象パスを表す。
 * @returns {boolean} 存在する場合は true を返す。
 */
function commandPathExists(candidatePath) {
  try {
    return fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

/**
 * 実行可能ファイル拡張子一覧を返す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {string[]} 拡張子一覧を返す。
 */
function getExecutableExtensions(env) {
  if (process.platform !== 'win32') {
    return [''];
  }

  const rawPathExt = env.PATHEXT || '.EXE;.CMD;.BAT;.COM';
  return rawPathExt.split(';').filter((value) => Boolean(value));
}

/**
 * 優先的に追加する Node 実行パス一覧を返す。
 * @param {string|undefined} currentWorkingDirectory 実行時の作業ディレクトリを表す。
 * @returns {string[]} 優先パス一覧を返す。
 */
function buildPreferredNodePaths(currentWorkingDirectory) {
  const preferredPaths = [];
  const seenPaths = new Set();
  const resolvedCwd = path.resolve(currentWorkingDirectory || process.cwd());
  const workspaceRoot = path.resolve(process.cwd());
  let currentDirectory = resolvedCwd;

  while (true) {
    const nodeBinPath = path.join(currentDirectory, 'node_modules', '.bin');
    if (!seenPaths.has(nodeBinPath)) {
      seenPaths.add(nodeBinPath);
      preferredPaths.push(nodeBinPath);
    }

    if (currentDirectory === workspaceRoot) {
      break;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  const mamoriNodeBinPath = path.join(workspaceRoot, '.mamori', 'node', 'node_modules', '.bin');
  if (!seenPaths.has(mamoriNodeBinPath)) {
    preferredPaths.push(mamoriNodeBinPath);
  }

  return preferredPaths;
}

/**
 * コマンド実行用の環境変数を返す。
 * @param {string|undefined} currentWorkingDirectory 実行時の作業ディレクトリを表す。
 * @param {NodeJS.ProcessEnv} env 元の環境変数を表す。
 * @returns {NodeJS.ProcessEnv} 調整済み環境変数を返す。
 */
function buildCommandEnvironment(currentWorkingDirectory, env) {
  const inheritedPath = env.PATH || '';
  const preferredPaths = buildPreferredNodePaths(currentWorkingDirectory);

  return {
    ...env,
    PATH: [...preferredPaths, inheritedPath].filter((value) => Boolean(value)).join(path.delimiter),
  };
}

/**
 * コマンドが実行可能か判定する。
 * @param {string} command 実行コマンドを表す。
 * @param {string|undefined} cwd 作業ディレクトリを表す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {boolean} 実行可能なら true を返す。
 */
function canResolveCommand(command, cwd, env) {
  const executableExtensions = getExecutableExtensions(env);
  const hasPathSeparator = command.includes('\\') || command.includes('/');
  const cwdDirectory = cwd || process.cwd();

  if (path.isAbsolute(command) || hasPathSeparator) {
    const candidatePath = path.isAbsolute(command)
      ? command
      : path.resolve(cwdDirectory, command);
    if (commandPathExists(candidatePath)) {
      return true;
    }

    if (process.platform === 'win32' && path.extname(candidatePath) === '') {
      return executableExtensions.some((extension) => commandPathExists(`${candidatePath}${extension.toLowerCase()}`)
        || commandPathExists(`${candidatePath}${extension}`));
    }
    return false;
  }

  const searchDirectories = [cwdDirectory, ...(env.PATH || '').split(path.delimiter).filter((value) => Boolean(value))];
  for (const searchDirectory of searchDirectories) {
    const baseCandidate = path.join(searchDirectory, command);
    if (commandPathExists(baseCandidate)) {
      return true;
    }
    if (process.platform === 'win32' && path.extname(baseCandidate) === '') {
      for (const extension of executableExtensions) {
        if (commandPathExists(`${baseCandidate}${extension.toLowerCase()}`)
          || commandPathExists(`${baseCandidate}${extension}`)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * command entry を実行する。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {object} commandEntry コマンド計画を表す。
 * @param {(command: string, args: string[], options?: object) => Promise<{exitCode: number, stdout: string, stderr: string}>} executor 実行器を表す。
 * @returns {Promise<{moduleRoot: string, tool: string, status: string, command?: string, args?: string[], exitCode?: number, stdout?: string, stderr?: string, message?: string}>} 実行結果を返す。
 */
async function executeCommandEntry(moduleRoot, commandEntry, executor) {
  const commandEnvironment = buildCommandEnvironment(commandEntry.cwd, process.env);

  if (!commandEntry.enabled) {
    return buildSkippedCommandResult(moduleRoot, commandEntry);
  }

  if (!canResolveCommand(commandEntry.command, commandEntry.cwd, commandEnvironment)) {
    return {
      moduleRoot,
      tool: commandEntry.tool,
      phase: commandEntry.phase,
      status: 'error',
      command: commandEntry.command,
      args: commandEntry.args || [],
      message: `command not found: ${commandEntry.command}`,
    };
  }

  try {
    const result = await executor(commandEntry.command, commandEntry.args || [], {
      cwd: commandEntry.cwd,
      env: commandEnvironment,
      timeoutMs: 30000,
    });

    if (result.exitCode !== 0 && isCommandStartFailure(result.stderr)) {
      return {
        moduleRoot,
        tool: commandEntry.tool,
        phase: commandEntry.phase,
        status: 'error',
        command: commandEntry.command,
        args: commandEntry.args || [],
        message: result.stderr.trim() || `failed to start ${commandEntry.command}`,
      };
    }

    return {
      moduleRoot,
      tool: commandEntry.tool,
      phase: commandEntry.phase,
      status: result.exitCode === 0 ? 'ok' : 'failed',
      command: commandEntry.command,
      args: commandEntry.args || [],
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      moduleRoot,
      tool: commandEntry.tool,
      phase: commandEntry.phase,
      status: 'error',
      command: commandEntry.command,
      args: commandEntry.args || [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 解決済み設定をもとに command plan を実行する。
 * @param {{commandPlan?: {modules?: object[]}}} resolution 解決済み設定を表す。
 * @param {{executor?: Function}=} options 実行オプションを表す。
 * @returns {Promise<{issues: object[], warnings: string[], commandResults: object[], exitCode: number}>} 実行結果を返す。
 */
async function runResolvedConfiguration(resolution, options = {}) {
  const result = createInitialRunResult();
  const executor = typeof options.executor === 'function'
    ? options.executor
    : execCommand;
  const modules = resolution.commandPlan && Array.isArray(resolution.commandPlan.modules)
    ? resolution.commandPlan.modules
    : [];

  result.warnings.push(...collectPlanWarnings(resolution.commandPlan || {}));

  for (const modulePlan of modules) {
    const commands = Array.isArray(modulePlan.commands) ? modulePlan.commands : [];
    for (const commandEntry of commands) {
      const commandResult = await executeCommandEntry(modulePlan.moduleRoot, commandEntry, executor);
      result.commandResults.push(commandResult);

      if (commandResult.status === 'failed') {
        result.exitCode = Math.max(result.exitCode, 1);
        result.warnings.push(
          `${commandResult.tool} exited with code ${commandResult.exitCode} in ${commandResult.moduleRoot}`,
        );
      }

      if (commandResult.status === 'error') {
        result.exitCode = 2;
        result.warnings.push(
          `${commandResult.tool} failed to start in ${commandResult.moduleRoot}: ${commandResult.message}`,
        );
      }

      if (commandResult.status === 'ok' || commandResult.status === 'failed') {
        result.issues.push(...extractIssues(commandResult));
      }
    }
  }

  if (
    resolution.mode === 'precommit'
    && resolution.scope === 'staged'
    && hasSuccessfulFormatter(result.commandResults)
  ) {
    const restageWarning = await restageFormattedFiles(resolution, executor);
    if (restageWarning) {
      result.exitCode = 2;
      result.warnings.push(`precommit restage failed: ${restageWarning}`);
    }
  }

  return result;
}

module.exports = {
  runResolvedConfiguration,
};