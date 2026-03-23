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

// HTML ファイル拡張子一覧を表す
const HTML_FILE_EXTENSIONS = new Set(['.html', '.htm']);

// inline script 抽出用の正規表現を表す
const INLINE_SCRIPT_PATTERN = /<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script>/giu;

// inline style 抽出用の正規表現を表す
const INLINE_STYLE_PATTERN = /<style\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/style>/giu;

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
    return eslintAdapter.parseEslintJson(
      commandResult.stdout || '',
      commandResult.filePathMappings,
    );
  }

  if (commandResult.tool === 'stylelint') {
    return stylelintAdapter.parseStylelintJson(
      typeof commandResult.stdout === 'string' && commandResult.stdout.trim() !== ''
        ? commandResult.stdout
        : (commandResult.stderr || ''),
      commandResult.filePathMappings,
    );
  }

  if (commandResult.tool === 'htmlhint') {
    return htmlhintAdapter.parseHtmlhintJson(commandResult.stdout || '');
  }

  return [];
}

/**
 * HTML ファイルか判定する。
 * @param {string} filePath 対象ファイルパスを表す。
 * @returns {boolean} HTML ファイルなら true を返す。
 */
function isHtmlFile(filePath) {
  return HTML_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * 属性文字列から指定属性の値を返す。
 * @param {string} attributes タグ属性文字列を表す。
 * @param {string} attributeName 属性名を表す。
 * @returns {string|undefined} 属性値を返す。
 */
function resolveAttributeValue(attributes, attributeName) {
  const attributePattern = new RegExp(
    `(?:^|\\s)${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'iu',
  );
  const attributeMatch = attributes.match(attributePattern);
  if (!attributeMatch) {
    return undefined;
  }

  return attributeMatch[1] || attributeMatch[2] || attributeMatch[3] || '';
}

/**
 * script タグ属性から正規化済み type 値を返す。
 * @param {string} attributes script タグ属性文字列を表す。
 * @returns {string} 小文字化し、パラメータ部を除去した type 値を返す。
 */
function resolveNormalizedInlineScriptType(attributes) {
  const typeValue = resolveAttributeValue(attributes, 'type');
  if (typeof typeValue !== 'string') {
    return '';
  }

  return typeValue
    .trim()
    .toLowerCase()
    .split(';', 1)[0]
    .trim();
}

/**
 * script タグ属性が ESLint 対象の JavaScript か判定する。
 * @param {string} attributes script タグ属性文字列を表す。
 * @returns {boolean} JavaScript として扱う場合は true を返す。
 */
function isLintableInlineScript(attributes) {
  if (typeof resolveAttributeValue(attributes, 'src') === 'string') {
    return false;
  }

  const normalizedType = resolveNormalizedInlineScriptType(attributes);
  if (normalizedType === '') {
    return true;
  }

  if (normalizedType === 'module') {
    return true;
  }

  return /(java|ecma)script$/u.test(normalizedType);
}

/**
 * script タグ属性から一時ファイル拡張子を返す。
 * @param {string} attributes script タグ属性文字列を表す。
 * @returns {string} 一時ファイル拡張子を返す。
 */
function resolveInlineScriptExtension(attributes) {
  const normalizedType = resolveNormalizedInlineScriptType(attributes);
  if (normalizedType === '') {
    return '.js';
  }

  return normalizedType === 'module' ? '.mjs' : '.js';
}

/**
 * style タグ属性が Stylelint 対象の CSS か判定する。
 * @param {string} attributes style タグ属性文字列を表す。
 * @returns {boolean} CSS として扱う場合は true を返す。
 */
function isLintableInlineStyle(attributes) {
  const typeValue = resolveAttributeValue(attributes, 'type');
  if (typeof typeValue !== 'string') {
    return true;
  }

  const normalizedType = typeValue.trim().toLowerCase();
  if (normalizedType === '' || normalizedType === 'text/css') {
    return true;
  }

  return normalizedType.startsWith('text/css;');
}

/**
 * 文字列インデックスから行・列を返す。
 * @param {string} text 対象文字列を表す。
 * @param {number} index 位置インデックスを表す。
 * @returns {{line: number, column: number}} 行・列を返す。
 */
function resolveLineAndColumn(text, index) {
  const normalizedPrefix = text.slice(0, index).replace(/\r\n?/gu, '\n');
  const lines = normalizedPrefix.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * inline script を ESLint 用ソースへ整形する。
 * @param {string} htmlText HTML 文字列を表す。
 * @param {number} startIndex script 本文の開始位置を表す。
 * @param {string} scriptBody script 本文を表す。
 * @returns {string} ESLint 用の一時ファイル内容を返す。
 */
function buildAlignedInlineScriptSource(htmlText, startIndex, scriptBody) {
  const location = resolveLineAndColumn(htmlText, startIndex);
  return `${'\n'.repeat(Math.max(location.line - 1, 0))}${' '.repeat(Math.max(location.column - 1, 0))}${scriptBody}`;
}

/**
 * 開始タグの本文開始オフセットを返す。
 * @param {string} tagText 開始タグを含む文字列を表す。
 * @returns {number} 本文開始オフセットを返す。
 */
function resolveStartTagBodyOffset(tagText) {
  let activeQuote = '';

  for (let index = 0; index < tagText.length; index += 1) {
    const character = tagText[index];
    if (activeQuote) {
      if (character === activeQuote) {
        activeQuote = '';
      }
      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (character === '>') {
      return index + 1;
    }
  }

  return tagText.indexOf('>') + 1;
}

/**
 * HTML から ESLint 対象の inline script 一覧を抽出する。
 * @param {string} htmlFilePath HTML ファイルパスを表す。
 * @returns {Array<{htmlFilePath: string, source: string, extension: string}>} 抽出結果一覧を返す。
 */
function extractInlineScriptSources(htmlFilePath) {
  const htmlText = fs.readFileSync(htmlFilePath, 'utf8');
  const extractedScripts = [];
  INLINE_SCRIPT_PATTERN.lastIndex = 0;

  let match;
  while ((match = INLINE_SCRIPT_PATTERN.exec(htmlText)) !== null) {
    const attributes = match[1] || '';
    const scriptBody = match[2] || '';

    if (!isLintableInlineScript(attributes) || scriptBody.trim() === '') {
      continue;
    }

    const bodyOffset = resolveStartTagBodyOffset(match[0]);
    const bodyStartIndex = match.index + bodyOffset;
    extractedScripts.push({
      htmlFilePath,
      source: buildAlignedInlineScriptSource(htmlText, bodyStartIndex, scriptBody),
      extension: resolveInlineScriptExtension(attributes),
    });
  }

  return extractedScripts;
}

/**
 * HTML から Stylelint 対象の inline style 一覧を抽出する。
 * @param {string} htmlFilePath HTML ファイルパスを表す。
 * @returns {Array<{htmlFilePath: string, source: string, extension: string}>} 抽出結果一覧を返す。
 */
function extractInlineStyleSources(htmlFilePath) {
  const htmlText = fs.readFileSync(htmlFilePath, 'utf8');
  const extractedStyles = [];
  INLINE_STYLE_PATTERN.lastIndex = 0;

  let match;
  while ((match = INLINE_STYLE_PATTERN.exec(htmlText)) !== null) {
    const attributes = match[1] || '';
    const styleBody = match[2] || '';

    if (!isLintableInlineStyle(attributes) || styleBody.trim() === '') {
      continue;
    }

    const bodyOffset = resolveStartTagBodyOffset(match[0]);
    const bodyStartIndex = match.index + bodyOffset;
    extractedStyles.push({
      htmlFilePath,
      source: buildAlignedInlineScriptSource(htmlText, bodyStartIndex, styleBody),
      extension: '.css',
    });
  }

  return extractedStyles;
}

/**
 * ESLint 向け inline script 一時ファイル群を作成する。
 * @param {string[]|undefined} inlineHtmlFiles HTML ファイル一覧を表す。
 * @param {string|undefined} currentWorkingDirectory 実行時の作業ディレクトリを表す。
 * @returns {{tempDirectory?: string, tempFilePaths: string[], filePathMappings: Record<string, string>}} 一時ファイル情報を返す。
 */
function materializeInlineScriptFiles(inlineHtmlFiles, currentWorkingDirectory) {
  if (!Array.isArray(inlineHtmlFiles) || inlineHtmlFiles.length === 0) {
    return {
      tempFilePaths: [],
      filePathMappings: {},
    };
  }

  const workspaceTempRoot = path.join(
    path.resolve(currentWorkingDirectory || process.cwd()),
    '.mamori',
    'tmp',
  );
  fs.mkdirSync(workspaceTempRoot, { recursive: true });
  const tempDirectory = fs.mkdtempSync(path.join(workspaceTempRoot, 'mamori-eslint-inline-'));
  const tempFilePaths = [];
  const filePathMappings = {};
  let scriptIndex = 0;

  for (const htmlFilePath of inlineHtmlFiles.filter((filePath) => isHtmlFile(filePath))) {
    const inlineScripts = extractInlineScriptSources(htmlFilePath);
    for (const inlineScript of inlineScripts) {
      const tempFilePath = path.join(
        tempDirectory,
        `${path.basename(htmlFilePath, path.extname(htmlFilePath))}.inline-${scriptIndex}${inlineScript.extension}`,
      );
      fs.writeFileSync(tempFilePath, inlineScript.source, 'utf8');
      tempFilePaths.push(tempFilePath);
      filePathMappings[path.resolve(tempFilePath)] = htmlFilePath;
      scriptIndex += 1;
    }
  }

  if (tempFilePaths.length === 0) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
    return {
      tempFilePaths: [],
      filePathMappings: {},
    };
  }

  return {
    tempDirectory,
    tempFilePaths,
    filePathMappings,
  };
}

/**
 * Stylelint 向け inline style 一時ファイル群を作成する。
 * @param {string[]|undefined} inlineHtmlFiles HTML ファイル一覧を表す。
 * @param {string|undefined} currentWorkingDirectory 実行時の作業ディレクトリを表す。
 * @returns {{tempDirectory?: string, tempFilePaths: string[], filePathMappings: Record<string, string>}} 一時ファイル情報を返す。
 */
function materializeInlineStyleFiles(inlineHtmlFiles, currentWorkingDirectory) {
  if (!Array.isArray(inlineHtmlFiles) || inlineHtmlFiles.length === 0) {
    return {
      tempFilePaths: [],
      filePathMappings: {},
    };
  }

  const workspaceTempRoot = path.join(
    path.resolve(currentWorkingDirectory || process.cwd()),
    '.mamori',
    'tmp',
  );
  fs.mkdirSync(workspaceTempRoot, { recursive: true });
  const tempDirectory = fs.mkdtempSync(path.join(workspaceTempRoot, 'mamori-stylelint-inline-'));
  const tempFilePaths = [];
  const filePathMappings = {};
  let styleIndex = 0;

  for (const htmlFilePath of inlineHtmlFiles.filter((filePath) => isHtmlFile(filePath))) {
    const inlineStyles = extractInlineStyleSources(htmlFilePath);
    for (const inlineStyle of inlineStyles) {
      const tempFilePath = path.join(
        tempDirectory,
        `${path.basename(htmlFilePath, path.extname(htmlFilePath))}.inline-style-${styleIndex}${inlineStyle.extension}`,
      );
      fs.writeFileSync(tempFilePath, inlineStyle.source, 'utf8');
      tempFilePaths.push(tempFilePath);
      filePathMappings[path.resolve(tempFilePath)] = htmlFilePath;
      styleIndex += 1;
    }
  }

  if (tempFilePaths.length === 0) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
    return {
      tempFilePaths: [],
      filePathMappings: {},
    };
  }

  return {
    tempDirectory,
    tempFilePaths,
    filePathMappings,
  };
}

/**
 * 実行前にコマンド引数と付帯情報を調整する。
 * @param {object} commandEntry コマンド計画を表す。
 * @returns {{args: string[], filePathMappings?: Record<string, string>, tempDirectory?: string, skipReason?: string}} 実行準備結果を返す。
 */
function prepareCommandExecution(commandEntry) {
  if (commandEntry.tool !== 'eslint' && commandEntry.tool !== 'stylelint') {
    return {
      args: Array.isArray(commandEntry.args) ? commandEntry.args : [],
    };
  }

  const directFiles = Array.isArray(commandEntry.directFiles) ? commandEntry.directFiles : [];
  const inlineArtifacts = commandEntry.tool === 'eslint'
    ? materializeInlineScriptFiles(commandEntry.inlineHtmlFiles, commandEntry.cwd)
    : materializeInlineStyleFiles(commandEntry.inlineHtmlFiles, commandEntry.cwd);
  if (directFiles.length === 0 && inlineArtifacts.tempFilePaths.length === 0) {
    return {
      args: Array.isArray(commandEntry.args) ? commandEntry.args : [],
      tempDirectory: inlineArtifacts.tempDirectory,
      skipReason: 'no-target-files',
    };
  }

  return {
    args: [...(Array.isArray(commandEntry.args) ? commandEntry.args : []), ...inlineArtifacts.tempFilePaths],
    filePathMappings: inlineArtifacts.filePathMappings,
    tempDirectory: inlineArtifacts.tempDirectory,
  };
}

/**
 * 実行準備で作成した一時ファイルを削除する。
 * @param {{tempDirectory?: string}|undefined} preparedCommand 実行準備結果を表す。
 * @returns {string|undefined} cleanup に失敗した場合の警告を返す。
 */
function cleanupPreparedCommand(preparedCommand) {
  if (!preparedCommand || !preparedCommand.tempDirectory) {
    return undefined;
  }

  try {
    fs.rmSync(preparedCommand.tempDirectory, { recursive: true, force: true });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return undefined;
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
  const inheritedPath = env.PATH || env.Path || '';
  const preferredPaths = buildPreferredNodePaths(currentWorkingDirectory);
  const resolvedPath = [...preferredPaths, inheritedPath].filter((value) => Boolean(value)).join(path.delimiter);

  const resolvedEnvironment = {
    ...env,
    PATH: resolvedPath,
  };

  if (process.platform === 'win32') {
    resolvedEnvironment.Path = resolvedPath;
  }

  return resolvedEnvironment;
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
  const baseEnvironment = {
    ...process.env,
    ...(commandEntry.env || {}),
  };
  const commandEnvironment = buildCommandEnvironment(commandEntry.cwd, baseEnvironment);
  let preparedCommand;
  let commandResult;

  if (!commandEntry.enabled) {
    return buildSkippedCommandResult(moduleRoot, commandEntry);
  }

  try {
    preparedCommand = prepareCommandExecution(commandEntry);

    if (preparedCommand.skipReason) {
      commandResult = {
        moduleRoot,
        tool: commandEntry.tool,
        phase: commandEntry.phase,
        status: 'skipped',
        reason: preparedCommand.skipReason,
      };
      return commandResult;
    }

    if (!canResolveCommand(commandEntry.command, commandEntry.cwd, commandEnvironment)) {
      commandResult = {
        moduleRoot,
        tool: commandEntry.tool,
        phase: commandEntry.phase,
        status: 'error',
        command: commandEntry.command,
        args: preparedCommand.args,
        message: `command not found: ${commandEntry.command}`,
      };
      return commandResult;
    }

    const result = await executor(commandEntry.command, preparedCommand.args, {
      cwd: commandEntry.cwd,
      env: commandEnvironment,
      timeoutMs: 30000,
    });

    if (result.exitCode !== 0 && isCommandStartFailure(result.stderr)) {
      commandResult = {
        moduleRoot,
        tool: commandEntry.tool,
        phase: commandEntry.phase,
        status: 'error',
        command: commandEntry.command,
        args: preparedCommand.args,
        message: result.stderr.trim() || `failed to start ${commandEntry.command}`,
      };
      return commandResult;
    }

    commandResult = {
      moduleRoot,
      tool: commandEntry.tool,
      phase: commandEntry.phase,
      status: result.exitCode === 0 ? 'ok' : 'failed',
      command: commandEntry.command,
      args: preparedCommand.args,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      filePathMappings: preparedCommand.filePathMappings,
    };
    return commandResult;
  } catch (error) {
    commandResult = {
      moduleRoot,
      tool: commandEntry.tool,
      phase: commandEntry.phase,
      status: 'error',
      command: commandEntry.command,
      args: preparedCommand && Array.isArray(preparedCommand.args)
        ? preparedCommand.args
        : (commandEntry.args || []),
      message: error instanceof Error ? error.message : String(error),
    };
    return commandResult;
  } finally {
    const cleanupWarning = cleanupPreparedCommand(preparedCommand);
    if (cleanupWarning && commandResult) {
      commandResult.warning = `temporary inline files cleanup failed in ${moduleRoot}: ${cleanupWarning}`;
    }
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

      if (commandResult.warning) {
        result.warnings.push(commandResult.warning);
      }

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