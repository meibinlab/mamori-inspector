'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

// Mamori 管理フック識別子を表す
const HOOK_MARKER = 'mamori-inspector-managed-hook';
// managed hook 実行を runner へ伝える環境変数名を表す
const MANAGED_HOOK_ENV_NAME = 'MAMORI_MANAGED_HOOK';
// 管理対象フック定義一覧を表す
const MANAGED_HOOKS = [
  {
    filename: 'pre-commit',
    mode: 'precommit',
    scope: 'staged',
  },
  {
    filename: 'pre-push',
    mode: 'prepush',
    scope: 'workspace',
  },
];

/**
 * Git hooks ディレクトリの絶対パスを返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {string} hooks ディレクトリの絶対パスを返す。
 */
function getGitHooksDirectory(currentWorkingDirectory) {
  return path.join(currentWorkingDirectory, '.git', 'hooks');
}

/**
 * 管理対象 hook の内容を返す。
 * @param {{filename: string, mode: string, scope: string}} hookDefinition hook 定義を表す。
 * @returns {string} hook 内容を返す。
 */
function buildHookScript(hookDefinition) {
  return [
    '#!/bin/sh',
    `# ${HOOK_MARKER}`,
    `# generated for ${hookDefinition.filename}`,
    'set -eu',
    'REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
    'NODE_BIN="${NODE:-node}"',
    'RUNNER_PATH="$REPO_ROOT/.mamori/mamori.js"',
    'if [ ! -f "$RUNNER_PATH" ]; then',
    `  printf '%s\\n' "mamori: warning: ${hookDefinition.filename} skipped because runner was not found at $RUNNER_PATH" >&2`,
    '  exit 0',
    'fi',
    'if ! command -v "$NODE_BIN" >/dev/null 2>&1; then',
    `  printf '%s\\n' "mamori: warning: ${hookDefinition.filename} skipped because node command was not found: $NODE_BIN" >&2`,
    '  exit 0',
    'fi',
    `if ! ${MANAGED_HOOK_ENV_NAME}=${hookDefinition.mode} "$NODE_BIN" "$RUNNER_PATH" run --mode ${hookDefinition.mode} --scope ${hookDefinition.scope} --execute; then`,
    `  printf '%s\\n' "mamori: warning: ${hookDefinition.filename} reported issues or execution errors, but Git continues" >&2`,
    'fi',
    'exit 0',
  ].join('\n');
}

/**
 * Git hooks ディレクトリの存在を検証する。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {{hooksDirectory?: string, error?: string}} 検証結果を返す。
 */
function resolveGitHooksDirectory(currentWorkingDirectory) {
  const hooksDirectory = getGitHooksDirectory(currentWorkingDirectory);

  try {
    if (!fs.existsSync(hooksDirectory) || !fs.statSync(hooksDirectory).isDirectory()) {
      return {
        error: 'git hooks directory was not found; open the repository root before installing hooks',
      };
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    hooksDirectory,
  };
}

/**
 * Git hooks をインストールする。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {{installed: string[], warnings: string[], error?: string}} 実行結果を返す。
 */
function installGitHooks(currentWorkingDirectory) {
  const resolvedDirectory = resolveGitHooksDirectory(currentWorkingDirectory);
  if (resolvedDirectory.error) {
    return {
      installed: [],
      warnings: [],
      error: resolvedDirectory.error,
    };
  }

  const installed = [];
  const warnings = [];

  for (const hookDefinition of MANAGED_HOOKS) {
    const hookPath = path.join(resolvedDirectory.hooksDirectory, hookDefinition.filename);
    if (fs.existsSync(hookPath)) {
      const currentContent = fs.readFileSync(hookPath, 'utf8');
      if (!currentContent.includes(HOOK_MARKER)) {
        warnings.push(`${hookDefinition.filename} already exists and was left unchanged`);
        continue;
      }
    }

    fs.writeFileSync(hookPath, `${buildHookScript(hookDefinition)}\n`, 'utf8');
    fs.chmodSync(hookPath, 0o755);
    installed.push(hookDefinition.filename);
  }

  return {
    installed,
    warnings,
  };
}

/**
 * Git hooks をアンインストールする。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {{removed: string[], warnings: string[], error?: string}} 実行結果を返す。
 */
function uninstallGitHooks(currentWorkingDirectory) {
  const resolvedDirectory = resolveGitHooksDirectory(currentWorkingDirectory);
  if (resolvedDirectory.error) {
    return {
      removed: [],
      warnings: [],
      error: resolvedDirectory.error,
    };
  }

  const removed = [];
  const warnings = [];

  for (const hookDefinition of MANAGED_HOOKS) {
    const hookPath = path.join(resolvedDirectory.hooksDirectory, hookDefinition.filename);
    if (!fs.existsSync(hookPath)) {
      continue;
    }

    const currentContent = fs.readFileSync(hookPath, 'utf8');
    if (!currentContent.includes(HOOK_MARKER)) {
      warnings.push(`${hookDefinition.filename} is not managed by Mamori Inspector and was left unchanged`);
      continue;
    }

    fs.rmSync(hookPath, { force: true });
    removed.push(hookDefinition.filename);
  }

  return {
    removed,
    warnings,
  };
}

module.exports = {
  HOOK_MARKER,
  installGitHooks,
  uninstallGitHooks,
};