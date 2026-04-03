'use strict';

// 子プロセス同期実行 API を表す
const { spawnSync } = require('child_process');
// ファイルシステム操作を表す
const fs = require('fs');
// HTTP クライアントを表す
const http = require('http');
// HTTPS クライアントを表す
const https = require('https');
// パス操作を表す
const path = require('path');
// stream pipeline を表す
const { pipeline } = require('stream/promises');
// URL 解析を表す
const { fileURLToPath, URL } = require('url');
// ツールカタログを表す
const {
  NODE_TOOL_PACKAGES,
  getGradleDefinition,
  getMavenDefinition,
  getSemgrepDefinition,
} = require('./catalog');

// 自動導入対象の Node ツール一覧を表す
const MANAGED_NODE_TOOL_NAMES = Object.keys(NODE_TOOL_PACKAGES);
// `.mamori/tools` 配下で cache-clear が削除対象にする管理ディレクトリ名を表す
const MANAGED_TOOL_CACHE_DIRECTORY_NAMES = ['cache', 'gradle', 'maven', 'python'];
// Windows の一時ディレクトリ rename 失敗で再試行するエラーコード一覧を表す
const WINDOWS_RETRYABLE_RENAME_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);

/**
 * ワークスペースごとの Mamori 管理ディレクトリを返す。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @returns {{mamoriRoot: string, nodeRoot: string, toolsRoot: string, cacheRoot: string, pythonPackagesRoot: string}} 管理ディレクトリ一覧を返す。
 */
function getManagedDirectories(workspaceRoot) {
  const mamoriRoot = path.join(workspaceRoot, '.mamori');
  const toolsRoot = path.join(mamoriRoot, 'tools');
  return {
    mamoriRoot,
    nodeRoot: path.join(mamoriRoot, 'node'),
    toolsRoot,
    cacheRoot: path.join(toolsRoot, 'cache'),
    pythonPackagesRoot: path.join(toolsRoot, 'python', 'packages'),
  };
}

/**
 * ディレクトリを再帰的に作成する。
 * @param {string} directoryPath 対象ディレクトリを表す。
 * @returns {void} 返り値はない。
 */
function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

/**
 * ディレクトリを再試行付きで削除する。
 * @param {string} targetPath 削除対象ディレクトリを表す。
 * @returns {void} 返り値はない。
 */
function removeDirectory(targetPath) {
  fs.rmSync(targetPath, {
    force: true,
    maxRetries: process.platform === 'win32' ? 5 : 0,
    recursive: true,
    retryDelay: process.platform === 'win32' ? 100 : 0,
  });
}

/**
 * 同期待機でファイルシステムの競合解消を待つ。
 * @param {number} milliseconds 待機時間ミリ秒を表す。
 * @returns {void} 返り値はない。
 */
function waitForFilesystem(milliseconds) {
  if (milliseconds <= 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Windows の一時ディレクトリ rename エラーが再試行対象か判定する。
 * @param {unknown} error 判定対象エラーを表す。
 * @returns {boolean} 再試行対象なら true を返す。
 */
function isRetryableWindowsRenameError(error) {
  return process.platform === 'win32'
    && Boolean(error)
    && typeof error === 'object'
    && WINDOWS_RETRYABLE_RENAME_ERROR_CODES.has(String(error.code || ''));
}

/**
 * アーカイブ導入用の一時ディレクトリを本番ディレクトリへ確定する。
 * @param {string} temporaryDirectory 一時ディレクトリを表す。
 * @param {string} installDirectory 本番ディレクトリを表す。
 * @returns {void} 返り値はない。
 */
function finalizeArchiveInstallation(temporaryDirectory, installDirectory) {
  ensureDirectory(path.dirname(installDirectory));

  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
    try {
      fs.renameSync(temporaryDirectory, installDirectory);
      return;
    } catch (error) {
      if (!isRetryableWindowsRenameError(error) || attemptIndex === 2) {
        break;
      }
      waitForFilesystem(100 * (attemptIndex + 1));
    }
  }

  fs.cpSync(temporaryDirectory, installDirectory, { force: true, recursive: true });
  removeDirectory(temporaryDirectory);
}

/**
 * コマンド名から実行ファイルの実体パスを返す。
 * @param {string} command コマンド名を表す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {string|undefined} 解決できた実行ファイルパスを返す。
 */
function resolveExecutablePath(command, currentWorkingDirectory, env) {
  const executableExtensions = process.platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter((value) => Boolean(value))
    : [''];
  const hasPathSeparator = command.includes('/') || command.includes('\\');

  if (path.isAbsolute(command) || hasPathSeparator) {
    const candidatePath = path.isAbsolute(command)
      ? command
      : path.resolve(currentWorkingDirectory, command);
    return resolvePathWithExecutableExtensions(candidatePath, executableExtensions);
  }

  const searchDirectories = [
    currentWorkingDirectory,
    ...String(env.PATH || '').split(path.delimiter).filter((value) => Boolean(value)),
  ];
  for (const searchDirectory of searchDirectories) {
    const resolvedPath = resolvePathWithExecutableExtensions(
      path.join(searchDirectory, command),
      executableExtensions,
    );
    if (resolvedPath) {
      return resolvedPath;
    }
  }

  return undefined;
}

/**
 * 実行可能拡張子を考慮した実在パスを返す。
 * @param {string} candidatePath 候補パスを表す。
 * @param {string[]} executableExtensions 実行可能拡張子一覧を表す。
 * @returns {string|undefined} 実在するパスを返す。
 */
function resolvePathWithExecutableExtensions(candidatePath, executableExtensions) {
  if (process.platform === 'win32' && path.extname(candidatePath) === '') {
    for (const extension of executableExtensions) {
      const extendedPath = `${candidatePath}${extension}`;
      if (fs.existsSync(extendedPath)) {
        return extendedPath;
      }
      const lowerCasePath = `${candidatePath}${extension.toLowerCase()}`;
      if (fs.existsSync(lowerCasePath)) {
        return lowerCasePath;
      }
    }
  }

  if (fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  if (process.platform !== 'win32' || path.extname(candidatePath) !== '') {
    return undefined;
  }

  for (const extension of executableExtensions) {
    const extendedPath = `${candidatePath}${extension}`;
    if (fs.existsSync(extendedPath)) {
      return extendedPath;
    }
    const lowerCasePath = `${candidatePath}${extension.toLowerCase()}`;
    if (fs.existsSync(lowerCasePath)) {
      return lowerCasePath;
    }
  }

  return undefined;
}

/**
 * ツール用のコマンド上書き設定を返す。
 * @param {string} toolName ツール名を表す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {string|undefined} 上書きコマンドを返す。
 */
function resolveCommandOverride(toolName, env) {
  const variableName = `MAMORI_TOOL_${toolName.toUpperCase()}_COMMAND`;
  const rawValue = env[variableName];
  return typeof rawValue === 'string' && rawValue.trim() !== '' ? rawValue.trim() : undefined;
}

/**
 * PATH を先頭拡張した実行時情報を返す。
 * @param {string} commandName 実行コマンド名を表す。
 * @param {string} executablePath 実行ファイルパスを表す。
 * @param {NodeJS.ProcessEnv} env 元の環境変数を表す。
 * @returns {{command: string, prependArgs: string[], env: NodeJS.ProcessEnv}} 実行時情報を返す。
 */
function buildPathAugmentedRuntime(commandName, executablePath, env) {
  const executableDirectory = path.dirname(executablePath);
  const nextPath = env.PATH && env.PATH.trim() !== ''
    ? `${executableDirectory}${path.delimiter}${env.PATH}`
    : executableDirectory;

  return {
    command: commandName,
    prependArgs: [],
    env: {
      PATH: nextPath,
    },
  };
}

/**
 * 外部プロセスを同期実行する。
 * @param {string} command 実行コマンドを表す。
 * @param {string[]} args 引数一覧を表す。
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}=} options 実行オプションを表す。
 * @returns {{status: number|null, stdout: string, stderr: string, error?: Error}} 実行結果を返す。
 */
function runProcess(command, args, options = {}) {
  const invocation = getProcessInvocation(
    command,
    args,
    options.cwd || process.cwd(),
    options.env || process.env,
  );
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: invocation.shell,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

/**
 * 子プロセス失敗時の表示用メッセージを返す。
 * @param {{stdout: string, stderr: string, error?: Error}} result 実行結果を表す。
 * @param {string} fallbackMessage 代替メッセージを表す。
 * @returns {string} 表示用メッセージを返す。
 */
function getProcessFailureMessage(result, fallbackMessage) {
  if (result.error && typeof result.error.message === 'string' && result.error.message.trim() !== '') {
    return result.error.message.trim();
  }

  if (result.stderr.trim() !== '') {
    return result.stderr.trim();
  }

  if (result.stdout.trim() !== '') {
    return result.stdout.trim();
  }

  return fallbackMessage;
}

/**
 * Windows を含む実行環境に応じたプロセス起動情報を返す。
 * @param {string} command 実行コマンドを表す。
 * @param {string[]} args 引数一覧を表す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {{command: string, args: string[], shell: boolean, windowsVerbatimArguments?: boolean}} 起動情報を返す。
 */
function getProcessInvocation(command, args, currentWorkingDirectory, env) {
  if (process.platform !== 'win32') {
    return { command, args, shell: false };
  }

  const resolvedCommand = resolveExecutablePath(command, currentWorkingDirectory, env) || command;
  const extension = path.extname(resolvedCommand).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') {
    return { command, args, shell: false };
  }

  const commandLine = [resolvedCommand, ...args]
    .map((value) => quoteWindowsCommandArgument(value))
    .join(' ');

  return {
    command: env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    shell: false,
    windowsVerbatimArguments: true,
  };
}

/**
 * cmd.exe へ渡す Windows コマンド引数を安全にクォートする。
 * @param {string} argument クォート対象引数を表す。
 * @returns {string} クォート済み引数文字列を返す。
 */
function quoteWindowsCommandArgument(argument) {
  return `"${String(argument).replace(/"/g, '""')}"`;
}

/**
 * PowerShell の単一引用符文字列として安全な文字列へ変換する。
 * @param {string} value 変換対象文字列を表す。
 * @returns {string} 変換後文字列を返す。
 */
function escapePowerShellSingleQuotedString(value) {
  return value.replace(/'/g, "''");
}

/**
 * PowerShell の EncodedCommand 用文字列へ変換する。
 * @param {string} commandText PowerShell コマンド文字列を表す。
 * @returns {string} Base64 エンコード済み文字列を返す。
 */
function encodePowerShellCommand(commandText) {
  return Buffer.from(commandText, 'utf16le').toString('base64');
}

/**
 * URL からファイルをダウンロードする。
 * @param {string} sourceUrl ダウンロード元 URL を表す。
 * @param {string} destinationPath 保存先パスを表す。
 * @returns {Promise<void>} 完了を待つ Promise を返す。
 */
async function downloadFile(sourceUrl, destinationPath) {
  ensureDirectory(path.dirname(destinationPath));
  const parsedUrl = new URL(sourceUrl);
  const client = parsedUrl.protocol === 'http:' ? http : https;

  await new Promise((resolve, reject) => {
    const request = client.get(parsedUrl, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destinationPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`download failed with status ${String(response.statusCode)}: ${sourceUrl}`));
        return;
      }

      const outputStream = fs.createWriteStream(destinationPath);
      pipeline(response, outputStream).then(resolve).catch(reject);
    });

    request.on('error', reject);
  });
}

/**
 * アーカイブまたはディレクトリをインストール先へ展開する。
 * @param {string} sourceUrl ソース URL を表す。
 * @param {string} cachePath キャッシュファイルパスを表す。
 * @param {string} destinationDirectory 展開先ディレクトリを表す。
 * @param {string} archiveType アーカイブ種別を表す。
 * @returns {Promise<void>} 完了を待つ Promise を返す。
 */
async function materializeSource(sourceUrl, cachePath, destinationDirectory, archiveType) {
  const parsedUrl = new URL(sourceUrl);

  if (parsedUrl.protocol === 'file:') {
    const localPath = fileURLToPath(parsedUrl);
    const localStats = fs.statSync(localPath);
    if (localStats.isDirectory()) {
      fs.cpSync(localPath, destinationDirectory, { recursive: true });
      return;
    }

    ensureDirectory(path.dirname(cachePath));
    fs.copyFileSync(localPath, cachePath);
    extractArchive(cachePath, destinationDirectory, archiveType);
    return;
  }

  if (!fs.existsSync(cachePath)) {
    await downloadFile(sourceUrl, cachePath);
  }
  extractArchive(cachePath, destinationDirectory, archiveType);
}

/**
 * アーカイブを展開する。
 * @param {string} archivePath アーカイブパスを表す。
 * @param {string} destinationDirectory 展開先ディレクトリを表す。
 * @param {string} archiveType アーカイブ種別を表す。
 * @returns {void} 返り値はない。
 */
function extractArchive(archivePath, destinationDirectory, archiveType) {
  ensureDirectory(destinationDirectory);

  let result;
  if (archiveType === 'zip' && process.platform === 'win32') {
    const commandText = [
      `$archivePath = '${escapePowerShellSingleQuotedString(archivePath)}'`,
      `$destinationDirectory = '${escapePowerShellSingleQuotedString(destinationDirectory)}'`,
      'Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationDirectory -Force',
    ].join('; ');
    result = runProcess(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodePowerShellCommand(commandText),
      ],
    );
  } else if (archiveType === 'zip') {
    result = runProcess('tar', ['-xf', archivePath, '-C', destinationDirectory]);
  } else {
    result = runProcess('tar', ['-xzf', archivePath, '-C', destinationDirectory]);
  }

  if (result.error || result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `failed to extract archive: ${archivePath}`);
  }
}

/**
 * 配下の相対実行パスを探索する。
 * @param {string} rootDirectory 探索ルートを表す。
 * @param {string[]} relativePaths 相対パス候補一覧を表す。
 * @param {number=} maxDepth 最大探索深度を表す。
 * @returns {string|undefined} 見つかった実行ファイルパスを返す。
 */
function findExecutableInTree(rootDirectory, relativePaths, maxDepth = 4) {
  for (const relativePath of relativePaths) {
    const directPath = path.join(rootDirectory, relativePath);
    if (fs.existsSync(directPath)) {
      return directPath;
    }
  }

  if (maxDepth <= 0) {
    return undefined;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const nestedPath = findExecutableInTree(
      path.join(rootDirectory, entry.name),
      relativePaths,
      maxDepth - 1,
    );
    if (nestedPath) {
      return nestedPath;
    }
  }

  return undefined;
}

/**
 * アーカイブ系ツールを導入して実行ファイルパスを返す。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {{tool: string, version: string, archiveType: string, executableRelativePaths: string[], sourceUrl: string}} definition ツール定義を表す。
 * @returns {Promise<string>} 実行ファイルパスを返す。
 */
async function ensureArchiveTool(workspaceRoot, definition) {
  const directories = getManagedDirectories(workspaceRoot);
  const installDirectory = path.join(directories.toolsRoot, definition.tool, definition.version);
  const existingExecutablePath = findExecutableInTree(installDirectory, definition.executableRelativePaths);
  if (existingExecutablePath) {
    return existingExecutablePath;
  }

  const fileName = path.basename(new URL(definition.sourceUrl).pathname) || `${definition.tool}.${definition.archiveType}`;
  const cachePath = path.join(directories.cacheRoot, definition.tool, definition.version, fileName);
  const temporaryDirectory = `${installDirectory}.tmp-${Date.now()}`;

  removeDirectory(temporaryDirectory);
  removeDirectory(installDirectory);
  ensureDirectory(temporaryDirectory);

  try {
    await materializeSource(definition.sourceUrl, cachePath, temporaryDirectory, definition.archiveType);
    const executablePath = findExecutableInTree(temporaryDirectory, definition.executableRelativePaths);
    if (!executablePath) {
      throw new Error(`installed ${definition.tool} but executable was not found`);
    }
    finalizeArchiveInstallation(temporaryDirectory, installDirectory);
  } catch (error) {
    removeDirectory(temporaryDirectory);
    throw error;
  }

  const installedExecutablePath = findExecutableInTree(installDirectory, definition.executableRelativePaths);
  if (!installedExecutablePath) {
    throw new Error(`installed ${definition.tool} but executable was not found`);
  }
  return installedExecutablePath;
}

/**
 * Node 管理ディレクトリの package.json を準備する。
 * @param {string} nodeRoot Node 管理ディレクトリを表す。
 * @returns {void} 返り値はない。
 */
function ensureNodePackageManifest(nodeRoot) {
  ensureDirectory(nodeRoot);
  const packageJsonPath = path.join(nodeRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    return;
  }

  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify({
      name: 'mamori-managed-node-tools',
      private: true,
    }, null, 2),
    'utf8',
  );
}

/**
 * npm コマンドを解決する。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {string} npm コマンドパスを返す。
 */
function resolveNpmCommand(workspaceRoot, env) {
  const commandOverride = env.MAMORI_TOOL_NPM_COMMAND;
  if (typeof commandOverride === 'string' && commandOverride.trim() !== '') {
    const trimmedOverride = commandOverride.trim();
    const resolvedOverride = resolveExecutablePath(trimmedOverride, workspaceRoot, env);
    return resolvedOverride || trimmedOverride;
  }

  const resolvedPath = resolveExecutablePath('npm', workspaceRoot, env)
    || resolveExecutablePath('npm.cmd', workspaceRoot, env);
  if (!resolvedPath) {
    throw new Error('npm command not found for managed Node tool installation');
  }
  return resolvedPath;
}

/**
 * Python ランチャーを解決する。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {{command: string, baseArgs: string[]}} Python ランチャー情報を返す。
 */
function resolvePythonLauncher(workspaceRoot, env) {
  const override = env.MAMORI_TOOL_PYTHON_COMMAND;
  if (typeof override === 'string' && override.trim() !== '') {
    return { command: override.trim(), baseArgs: [] };
  }

  const candidates = process.platform === 'win32'
    ? [
      { command: 'py', baseArgs: ['-3'] },
      { command: 'python', baseArgs: [] },
      { command: 'python3', baseArgs: [] },
    ]
    : [
      { command: 'python3', baseArgs: [] },
      { command: 'python', baseArgs: [] },
    ];

  for (const candidate of candidates) {
    const resolvedPath = resolveExecutablePath(candidate.command, workspaceRoot, env);
    if (resolvedPath) {
      return {
        command: resolvedPath,
        baseArgs: candidate.baseArgs,
      };
    }
  }

  throw new Error('python command not found for Semgrep installation');
}

/**
 * Node 系ツールの実行ファイルパスを返す。
 * @param {string} nodeRoot Node 管理ディレクトリを表す。
 * @param {string} toolName ツール名を表す。
 * @returns {string|undefined} 実行ファイルパスを返す。
 */
function resolveManagedNodeToolPath(nodeRoot, toolName) {
  const executableName = process.platform === 'win32' ? `${toolName}.cmd` : toolName;
  const commandPath = path.join(nodeRoot, 'node_modules', '.bin', executableName);
  return fs.existsSync(commandPath) ? commandPath : undefined;
}

/**
 * module 直近の project node_modules/.bin からツールパスを返す。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {string} toolName ツール名を表す。
 * @returns {string|undefined} 見つかったツールパスを返す。
 */
function resolveProjectNodeToolPath(workspaceRoot, moduleRoot, toolName) {
  const executableName = process.platform === 'win32' ? `${toolName}.cmd` : toolName;
  let currentDirectory = moduleRoot;
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);

  while (true) {
    const candidatePath = path.join(currentDirectory, 'node_modules', '.bin', executableName);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }

    if (path.resolve(currentDirectory) === normalizedWorkspaceRoot) {
      break;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  return undefined;
}

/**
 * Node 系ツール群を `.mamori/node` に導入する。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {NodeJS.ProcessEnv=} env 環境変数を表す。
 * @returns {void} 返り値はない。
 */
function ensureManagedNodeTools(workspaceRoot, env = process.env) {
  const directories = getManagedDirectories(workspaceRoot);
  const missingTools = MANAGED_NODE_TOOL_NAMES.filter(
    (toolName) => !resolveManagedNodeToolPath(directories.nodeRoot, toolName),
  );
  if (missingTools.length === 0) {
    return;
  }

  ensureNodePackageManifest(directories.nodeRoot);
  const npmCommand = resolveNpmCommand(workspaceRoot, env);
  for (const toolName of missingTools) {
    const packageSpec = NODE_TOOL_PACKAGES[toolName].packageName;
    const result = runProcess(
      npmCommand,
      [
        'install',
        '--prefix',
        directories.nodeRoot,
        '--save-prod',
        '--no-package-lock',
        '--no-fund',
        '--no-audit',
        packageSpec,
      ],
      {
        cwd: workspaceRoot,
        env,
      },
    );

    if (result.error || result.status !== 0) {
      throw new Error(
        `failed to install managed Node tool ${toolName}: ${getProcessFailureMessage(
          result,
          'managed Node tool installation failed',
        )}`,
      );
    }
  }
}

/**
 * Semgrep 用 Python パッケージを導入する。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {{tool: string, version: string, packageName: string}} definition Semgrep 定義を表す。
 * @param {NodeJS.ProcessEnv=} env 環境変数を表す。
 * @returns {{command: string, prependArgs: string[], env: NodeJS.ProcessEnv}} 実行時情報を返す。
 */
function ensureManagedSemgrep(workspaceRoot, definition, env = process.env) {
  const directories = getManagedDirectories(workspaceRoot);
  const launcher = resolvePythonLauncher(workspaceRoot, env);
  const packageRoot = directories.pythonPackagesRoot;
  const packageDirectory = path.join(packageRoot, definition.packageName);

  if (!fs.existsSync(packageDirectory)) {
    ensureDirectory(packageRoot);
    const result = runProcess(
      launcher.command,
      [
        ...launcher.baseArgs,
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-warn-script-location',
        '--target',
        packageRoot,
        `${definition.packageName}==${definition.version}`,
      ],
      {
        cwd: workspaceRoot,
        env,
      },
    );

    if (result.error || result.status !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'failed to install Semgrep');
    }
  }

  const pythonPath = env.PYTHONPATH && env.PYTHONPATH.trim() !== ''
    ? `${packageRoot}${path.delimiter}${env.PYTHONPATH}`
    : packageRoot;
  return {
    command: launcher.command,
    prependArgs: [...launcher.baseArgs, '-m', 'semgrep'],
    env: {
      PYTHONPATH: pythonPath,
    },
  };
}

/**
 * setup コマンド向けに管理対象ツールをすべて準備する。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {NodeJS.ProcessEnv=} env 環境変数を表す。
 * @returns {Promise<Array<{tool: string, location: string}>>} 導入結果一覧を返す。
 */
async function ensureWorkspaceTooling(workspaceRoot, env = process.env) {
  const results = [];
  const mavenExecutablePath = await ensureArchiveTool(workspaceRoot, getMavenDefinition(env));
  results.push({ tool: 'maven', location: mavenExecutablePath });

  const gradleExecutablePath = await ensureArchiveTool(workspaceRoot, getGradleDefinition(env));
  results.push({ tool: 'gradle', location: gradleExecutablePath });

  ensureManagedNodeTools(workspaceRoot, env);
  for (const toolName of MANAGED_NODE_TOOL_NAMES) {
    const toolPath = resolveManagedNodeToolPath(getManagedDirectories(workspaceRoot).nodeRoot, toolName);
    if (toolPath) {
      results.push({ tool: toolName, location: toolPath });
    }
  }

  const semgrepOverride = resolveCommandOverride('semgrep', env);
  if (semgrepOverride) {
    results.push({ tool: 'semgrep', location: semgrepOverride });
  } else {
    const semgrepRuntime = ensureManagedSemgrep(workspaceRoot, getSemgrepDefinition(env), env);
    results.push({ tool: 'semgrep', location: semgrepRuntime.command });
  }

  return results;
}

/**
 * 管理キャッシュを削除する。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @returns {string[]} 削除したディレクトリ一覧を返す。
 */
function clearManagedToolCaches(workspaceRoot) {
  const directories = getManagedDirectories(workspaceRoot);
  const removedDirectories = [];

  for (const targetPath of MANAGED_TOOL_CACHE_DIRECTORY_NAMES.map((directoryName) => (
    path.join(directories.toolsRoot, directoryName)
  ))) {
    if (!fs.existsSync(targetPath)) {
      continue;
    }
    removeDirectory(targetPath);
    removedDirectories.push(targetPath);
  }

  for (const targetPath of [directories.nodeRoot]) {
    if (!fs.existsSync(targetPath)) {
      continue;
    }
    removeDirectory(targetPath);
    removedDirectories.push(targetPath);
  }

  return removedDirectories;
}

/**
 * 実行時のコマンド上書きを解決する。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {{tool: string, command: string}} commandEntry コマンド計画を表す。
 * @param {NodeJS.ProcessEnv=} env 環境変数を表す。
 * @returns {Promise<{command: string, prependArgs: string[], env: NodeJS.ProcessEnv}>} 実行時情報を返す。
 */
async function resolveCommandEntryRuntime(workspaceRoot, moduleRoot, commandEntry, env = process.env) {
  const commandOverride = resolveCommandOverride(commandEntry.tool, env);
  if (commandOverride) {
    return {
      command: commandOverride,
      prependArgs: [],
      env: {},
    };
  }

  if (commandEntry.tool === 'semgrep') {
    const resolvedSystemCommand = resolveExecutablePath(commandEntry.command, moduleRoot, env);
    if (resolvedSystemCommand) {
      return {
        command: commandEntry.command,
        prependArgs: [],
        env: {},
      };
    }

    return ensureManagedSemgrep(workspaceRoot, getSemgrepDefinition(env), env);
  }

  if (MANAGED_NODE_TOOL_NAMES.includes(commandEntry.tool)) {
    const projectToolPath = resolveProjectNodeToolPath(workspaceRoot, moduleRoot, commandEntry.tool);
    if (projectToolPath) {
      return {
        command: commandEntry.command,
        prependArgs: [],
        env: {},
      };
    }

    const directories = getManagedDirectories(workspaceRoot);
    let managedToolPath = resolveManagedNodeToolPath(directories.nodeRoot, commandEntry.tool);
    if (!managedToolPath) {
      ensureManagedNodeTools(workspaceRoot, env);
      managedToolPath = resolveManagedNodeToolPath(directories.nodeRoot, commandEntry.tool);
    }
    if (!managedToolPath) {
      throw new Error(`managed ${commandEntry.tool} executable was not found after installation`);
    }

    return buildPathAugmentedRuntime(commandEntry.command, managedToolPath, env);
  }

  const isWrapperCommand = commandEntry.command !== 'mvn' && commandEntry.command !== 'gradle';
  if (isWrapperCommand) {
    return {
      command: commandEntry.command,
      prependArgs: [],
      env: {},
    };
  }

  const resolvedSystemCommand = resolveExecutablePath(commandEntry.command, moduleRoot, env);
  if (resolvedSystemCommand) {
    return {
      command: commandEntry.command,
      prependArgs: [],
      env: {},
    };
  }

  if (commandEntry.command === 'mvn') {
    return buildPathAugmentedRuntime(
      commandEntry.command,
      await ensureArchiveTool(workspaceRoot, getMavenDefinition(env)),
      env,
    );
  }

  return buildPathAugmentedRuntime(
    commandEntry.command,
    await ensureArchiveTool(workspaceRoot, getGradleDefinition(env)),
    env,
  );
}

module.exports = {
  clearManagedToolCaches,
  ensureWorkspaceTooling,
  getManagedDirectories,
  resolveCommandEntryRuntime,
};