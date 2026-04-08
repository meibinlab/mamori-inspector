// VS Code 拡張APIを表す
import * as vscode from 'vscode';
// 子プロセス実行 API を表す
import { spawn } from 'child_process';
// Node のファイルシステム API を表す
import * as fs from 'fs';
// Node のパス操作 API を表す
import * as path from 'path';
// hooks 成功通知の整形処理を表す
import {
  reportHooksCommandSuccess,
  type HooksCommandMessages,
  type MamoriHooksAction,
} from './hooks-command-report';
// SARIF Diagnostics 変換器を表す
import { loadSarifFindings, SarifFinding } from './sarif-diagnostics';
// 保存時通知文言補助を表す
import {
  getSaveCheckStartStatusMessage as buildSaveCheckStartStatusMessage,
  getSaveCheckToolLabel as buildSaveCheckToolLabel,
  parseSaveCheckToolStartLine as parseSaveCheckToolStartOutputLine,
} from './save-check-notifications';
// 保守コマンドの warning 通知補助を表す
import {
  reportMaintenanceCommandSuccess,
  type MaintenanceCommandMessages,
} from './maintenance-command-report';
// 保存時チェックのスケジューラーを表す
import { SaveCheckScheduler } from './save-check-scheduler';

// 診断コレクション名を表す
const DIAGNOSTIC_COLLECTION_NAME = 'mamori-inspector';
// 拡張設定セクション名を表す
const EXTENSION_CONFIGURATION_SECTION = 'mamori-inspector';
// 有効化設定キー名を表す
const ENABLED_CONFIGURATION_KEY = 'enabled';
// 手動実行向けの SARIF 出力先を表す
const MANUAL_SARIF_OUTPUT = path.join('.mamori', 'out', 'combined.sarif');
// 保存時実行向けの SARIF 出力先を表す
const SAVE_SARIF_OUTPUT = path.join('.mamori', 'out', 'combined-save.sarif');
// ワークスペースへ同期する Mamori runtime の静的エントリ一覧を表す
const WORKSPACE_MAMORI_RUNTIME_ENTRIES = [
  'mamori.js',
  'package.json',
  'adapters',
  'config',
  'core',
  'detectors',
  'hooks',
  path.join('tools', 'catalog.js'),
  path.join('tools', 'exec.js'),
  path.join('tools', 'provision.js'),
];
// 保存時自動チェック対象の言語一覧を表す
const AUTO_SAVE_LANGUAGE_IDS = new Set([
  'java',
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'css',
  'scss',
  'sass',
  'html',
]);
// 実行中の追随再実行を抑止する拡張子一覧を表す
const AUTO_SAVE_NON_QUEUE_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.cts',
  '.mts',
  '.tsx',
  '.css',
  '.scss',
  '.sass',
  '.html',
  '.htm',
]);
// 保存時チェックのデバウンス時間を表す
const SAVE_DEBOUNCE_MILLISECONDS = 400;
// 自己再帰抑止時間を表す
const SAVE_SUPPRESSION_MILLISECONDS = 1500;
// 設定反映待機の上限時間を表す
const CONFIGURATION_UPDATE_TIMEOUT_MILLISECONDS = 5000;
// 設定反映待機のポーリング間隔を表す
const CONFIGURATION_UPDATE_POLLING_MILLISECONDS = 100;
// 非エラー通知を自動非表示にする時間を表す
const TRANSIENT_NON_ERROR_NOTIFICATION_MILLISECONDS = 5000;

/** 一時トーストの自動非表示時間を表す。 */
const TRANSIENT_NOTIFICATION_TOAST_MILLISECONDS = 3000;

/** ローカライズ埋め込み引数を表す。 */
type LocalizationArguments = Array<string | number | boolean> | Record<string, string | number | boolean>;
/** 非エラー通知向け表示先を表す。 */
type TransientMessagePresenter = {
  showInformationMessage: (message: string) => Thenable<unknown>;
  showWarningMessage: (message: string) => Thenable<unknown>;
};

/**
 * 既定英語文言をローカライズする。
 * @param message 既定文言を表す。
 * @param comment 翻訳向け補足を表す。
 * @param args 埋め込み引数を表す。
 * @returns ローカライズ済み文言を返す。
 */
function localize(
  message: string,
  comment: string | string[],
  args?: LocalizationArguments,
): string {
  return vscode.l10n.t({ message, comment, args });
}

/**
 * ワークスペース未選択時の警告文言を返す。
 * @returns 警告文言を返す。
 */
function getOpenWorkspaceMessage(): string {
  return localize(
    'Mamori Inspector: Open a workspace first.',
    'Warning message shown when a command requires an open workspace.',
  );
}

/**
 * ワークスペース選択プレースホルダーを返す。
 * @returns プレースホルダー文言を返す。
 */
function getWorkspaceSelectionPlaceholder(): string {
  return localize(
    'Select the workspace for Mamori Inspector.',
    'Placeholder text shown when the user must choose a workspace folder.',
  );
}

/**
 * hooks 進捗タイトルを返す。
 * @param action hooks 操作種別を表す。
 * @returns 進捗タイトルを返す。
 */
function getHooksProgressTitle(action: MamoriHooksAction): string {
  return action === 'install'
    ? localize(
      'Installing Mamori Inspector Git hooks',
      'Progress notification title while installing Git hooks.',
    )
    : localize(
      'Uninstalling Mamori Inspector Git hooks',
      'Progress notification title while uninstalling Git hooks.',
    );
}

/**
 * hooks 失敗通知文言を返す。
 * @param action hooks 操作種別を表す。
 * @param details 失敗詳細を表す。
 * @returns エラー通知文言を返す。
 */
function getHooksFailureMessage(action: MamoriHooksAction, details: string): string {
  return action === 'install'
    ? localize(
      'Mamori Inspector: Failed to install Git hooks. {0}',
      'Error message shown when installing Git hooks fails.',
      [details],
    )
    : localize(
      'Mamori Inspector: Failed to uninstall Git hooks. {0}',
      'Error message shown when uninstalling Git hooks fails.',
      [details],
    );
}

/**
 * hooks 成功通知文言を返す。
 * @returns hooks 通知文言を返す。
 */
function getHooksCommandMessages(): HooksCommandMessages {
  return {
    installSuccessMessage: localize(
      'Mamori Inspector: Installed Git hooks.',
      'Information message shown after Git hooks are installed successfully.',
    ),
    uninstallSuccessMessage: localize(
      'Mamori Inspector: Uninstalled Git hooks.',
      'Information message shown after Git hooks are uninstalled successfully.',
    ),
    buildWarningMessage: (warnings: string) => localize(
      'Mamori Inspector: Git hooks were processed, but some hooks were left unchanged. {0}',
      'Warning message shown when Git hooks processing succeeds with skipped hooks.',
      [warnings],
    ),
  };
}

/**
 * 保守コマンド進捗タイトルを返す。
 * @param action 保守コマンド種別を表す。
 * @returns 進捗タイトルを返す。
 */
function getMaintenanceProgressTitle(action: MamoriMaintenanceAction): string {
  return action === 'setup'
    ? localize(
      'Setting up Mamori Inspector managed tools',
      'Progress notification title while managed tools are being set up.',
    )
    : localize(
      'Clearing Mamori Inspector cache',
      'Progress notification title while the extension cache is being cleared.',
    );
}

/**
 * 保守コマンド成功通知文言を返す。
 * @param action 保守コマンド種別を表す。
 * @returns 情報通知文言を返す。
 */
function getMaintenanceSuccessMessage(action: MamoriMaintenanceAction): string {
  return action === 'setup'
    ? localize(
      'Mamori Inspector: Set up managed tools.',
      'Information message shown after managed tools are set up successfully.',
    )
    : localize(
      'Mamori Inspector: Cleared the cache.',
      'Information message shown after the extension cache is cleared successfully.',
    );
}

/**
 * 保守コマンド warning 通知文言を返す。
 * @param action 保守コマンド種別を表す。
 * @param warnings 警告内容を表す。
 * @returns 警告通知文言を返す。
 */
function getMaintenanceWarningMessage(action: MamoriMaintenanceAction, warnings: string): string {
  return action === 'setup'
    ? localize(
      'Mamori Inspector: Managed tool setup completed, but local Git exclude updates were skipped. {0}',
      'Warning message shown when setup succeeds but local Git exclude updates could not be completed.',
      [warnings],
    )
    : localize(
      'Mamori Inspector: Cache clear completed with warnings. {0}',
      'Warning message shown when cache clear succeeds with warnings.',
      [warnings],
    );
}

/**
 * 保守コマンド通知文言を返す。
 * @returns 保守コマンド通知文言を返す。
 */
function getMaintenanceCommandMessages(): MaintenanceCommandMessages {
  return {
    setupSuccessMessage: getMaintenanceSuccessMessage('setup'),
    cacheClearSuccessMessage: getMaintenanceSuccessMessage('cache-clear'),
    buildWarningMessage: (action: 'setup' | 'cache-clear', warnings: string) => (
      getMaintenanceWarningMessage(action, warnings)
    ),
  };
}

/**
 * 保守コマンド失敗通知文言を返す。
 * @param action 保守コマンド種別を表す。
 * @param details 失敗詳細を表す。
 * @returns エラー通知文言を返す。
 */
function getMaintenanceFailureMessage(action: MamoriMaintenanceAction, details: string): string {
  return action === 'setup'
    ? localize(
      'Mamori Inspector: Failed to set up managed tools. {0}',
      'Error message shown when managed tools setup fails.',
      [details],
    )
    : localize(
      'Mamori Inspector: Failed to clear the cache. {0}',
      'Error message shown when cache clearing fails.',
      [details],
    );
}

/**
 * 保存時チェック結果のステータスバー文言を返す。
 * @param diagnosticsCount 診断件数を表す。
 * @returns ステータスバー文言を返す。
 */
function getSaveCheckStatusMessage(diagnosticsCount: number): string {
  return localize(
    'Mamori Inspector: Reflected {0} save-check diagnostics.',
    'Status bar message shown after save-check diagnostics are published.',
    [diagnosticsCount],
  );
}

/**
 * 非エラー通知を自動非表示の status bar へ表示する。
 * @param message 表示するメッセージを表す。
 * @returns 返り値はない。
 */
function showTransientNonErrorMessage(message: string): void {
  void vscode.window.setStatusBarMessage(
    message,
    TRANSIENT_NON_ERROR_NOTIFICATION_MILLISECONDS,
  );
}

/**
 * 通知エリアへ自動非表示の一時トーストを表示する。
 * @param message 表示するメッセージを表す。
 * @returns 返り値はない。
 */
function showTransientNotificationToast(message: string): void {
  void vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: message,
      cancellable: false,
    },
    async() => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, TRANSIENT_NOTIFICATION_TOAST_MILLISECONDS);
      });
    },
  );
}

/**
 * hooks / maintenance 成功通知向けの表示先を返す。
 * @returns 通知表示先を返す。
 */
function getTransientMessagePresenter(): TransientMessagePresenter {
  return {
    showInformationMessage: async(message: string) => {
      showTransientNonErrorMessage(message);
      return undefined;
    },
    showWarningMessage: async(message: string) => {
      showTransientNonErrorMessage(message);
      return undefined;
    },
  };
}

/**
 * 保存時 CLI 出力から開始したツール ID を抽出する。
 * @param outputLine CLI の標準出力 1 行を表す。
 * @returns ツール ID を返す。
 */
function parseSaveCheckToolStartLine(outputLine: string): string | undefined {
  return parseSaveCheckToolStartOutputLine(outputLine);
}

/**
 * 保存時通知に表示するツール名を返す。
 * @param toolId CLI が通知したツール ID を表す。
 * @returns 表示用ツール名を返す。
 */
function getSaveCheckToolLabel(toolId: string): string {
  return buildSaveCheckToolLabel(toolId);
}

/**
 * 保存時開始ステータス文言を返す。
 * @param fileName 対象ファイル名を表す。
 * @param toolLabel 表示用ツール名を表す。
 * @returns ステータス文言を返す。
 */
function getSaveCheckStartStatusMessage(fileName: string, toolLabel: string): string {
  return localize(
    buildSaveCheckStartStatusMessage(fileName, toolLabel),
    'Status bar message shown when a save-time formatter or checker starts for a file.',
  );
}

/**
 * 利用可能ワークスペースなしの警告文言を返す。
 * @returns 警告文言を返す。
 */
function getNoAvailableWorkspaceMessage(): string {
  return localize(
    'Mamori Inspector: No available workspace folders were found.',
    'Warning message shown when all workspace folders are missing.',
  );
}

/**
 * 手動実行の進捗タイトルを返す。
 * @returns 進捗タイトルを返す。
 */
function getWorkspaceCheckProgressTitle(): string {
  return localize(
    'Running Mamori Inspector',
    'Progress notification title while a manual workspace check is running.',
  );
}

/**
 * 手動実行開始の一時トースト文言を返す。
 * @returns 開始通知文言を返す。
 */
function getWorkspaceCheckStartedMessage(): string {
  return localize(
    'Mamori Inspector: Started workspace check.',
    'Transient notification shown when a manual workspace check starts.',
  );
}

/**
 * 手動実行成功通知文言を返す。
 * @param diagnosticsCount 診断件数を表す。
 * @returns 情報通知文言を返す。
 */
function getWorkspaceCheckSuccessMessage(diagnosticsCount: number): string {
  return localize(
    'Mamori Inspector: Reflected {0} diagnostics.',
    'Information message shown after a manual workspace check publishes diagnostics.',
    [diagnosticsCount],
  );
}

/**
 * 手動実行失敗通知文言を返す。
 * @param details 失敗詳細を表す。
 * @returns エラー通知文言を返す。
 */
function getWorkspaceCheckFailureMessage(details: string): string {
  return localize(
    'Mamori Inspector: Execution failed. {0}',
    'Error message shown when a manual workspace check fails.',
    [details],
  );
}

/**
 * ワークスペース有効化の成功通知文言を返す。
 * @param enabled 有効化後の状態を表す。
 * @param workspaceFolderName 対象ワークスペース名を表す。
 * @returns 情報通知文言を返す。
 */
function getWorkspaceEnablementSuccessMessage(enabled: boolean, workspaceFolderName: string): string {
  return enabled
    ? localize(
      'Mamori Inspector: Enabled in workspace "{0}".',
      'Information message shown after enabling Mamori Inspector in a workspace folder.',
      [workspaceFolderName],
    )
    : localize(
      'Mamori Inspector: Disabled in workspace "{0}".',
      'Information message shown after disabling Mamori Inspector in a workspace folder.',
      [workspaceFolderName],
    );
}

/**
 * ワークスペース有効化の更新失敗通知文言を返す。
 * @param details 失敗詳細を表す。
 * @returns エラー通知文言を返す。
 */
function getWorkspaceEnablementFailureMessage(details: string): string {
  return localize(
    'Mamori Inspector: Failed to update workspace enablement. {0}',
    'Error message shown when updating workspace enablement fails.',
    [details],
  );
}

/**
 * Mamori CLI 実行条件を表す。
 */
interface MamoriCliRunOptions {
  /** 実行モードを表す。 */
  mode: 'manual' | 'save';
  /** 実行スコープを表す。 */
  scope: 'workspace' | 'file';
  /** SARIF 出力パスを表す。 */
  sarifOutputPath: string;
  /** 対象ファイル一覧を表す。 */
  files?: string[];
}

/**
 * Mamori CLI 実行結果を表す。
 */
interface MamoriCliCommandResult {
  /** 標準出力を表す。 */
  stdout: string;
  /** 標準エラー出力を表す。 */
  stderr: string;
}

/**
 * Mamori CLI 実行中の逐次イベントを表す。
 */
interface MamoriCliCommandEvents {
  /** 標準出力 1 行を受け取る処理を表す。 */
  onStdoutLine?: (line: string) => void;
}

/**
 * Mamori CLI の保守コマンド種別を表す。
 */
type MamoriMaintenanceAction = 'setup' | 'cache-clear';

/**
 * URI ごとの Diagnostics 収集結果を表す。
 */
interface DiagnosticsByUriEntry {
  /** 対象 URI を表す。 */
  uri: vscode.Uri;
  /** Diagnostics 一覧を表す。 */
  diagnostics: vscode.Diagnostic[];
}

/**
 * 実行種別ごとの Diagnostics 保持状態を表す。
 */
interface DiagnosticsState {
  /** 手動実行由来の Diagnostics を表す。 */
  manualDiagnosticsByUri: Map<string, DiagnosticsByUriEntry>;
  /** 保存時実行由来の Diagnostics を表す。 */
  saveDiagnosticsByUri: Map<string, DiagnosticsByUriEntry>;
}

/**
 * ワークスペース直下の Mamori ルートパスを返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns Mamori ルートパスを返す。
 */
function getWorkspaceMamoriRootPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, '.mamori');
}

/**
 * ワークスペース直下の Mamori CLI パスを返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns CLI スクリプトパスを返す。
 */
function getWorkspaceMamoriCliPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getWorkspaceMamoriRootPath(workspaceFolder), 'mamori.js');
}

/**
 * 拡張同梱の Mamori ルートパスを返す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns Mamori ルートパスを返す。
 */
function getBundledMamoriRootPath(extensionRootPath: string): string {
  return path.join(extensionRootPath, '.mamori');
}

/**
 * 拡張同梱の Mamori CLI パスを返す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns CLI スクリプトパスを返す。
 */
function getBundledMamoriCliPath(extensionRootPath: string): string {
  return path.join(getBundledMamoriRootPath(extensionRootPath), 'mamori.js');
}

/**
 * 拡張同梱の Mamori runtime をワークスペースへ同期する。
 * @param workspaceFolder 同期先ワークスペースフォルダーを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns 返り値はない。
 */
function synchronizeMamoriRuntimeToWorkspace(
  workspaceFolder: vscode.WorkspaceFolder,
  extensionRootPath: string,
): void {
  const bundledMamoriRootPath = getBundledMamoriRootPath(extensionRootPath);
  const workspaceMamoriRootPath = getWorkspaceMamoriRootPath(workspaceFolder);

  for (const runtimeEntry of WORKSPACE_MAMORI_RUNTIME_ENTRIES) {
    const sourcePath = path.join(bundledMamoriRootPath, runtimeEntry);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Bundled Mamori runtime entry was not found: ${sourcePath}`);
    }

    const targetPath = path.join(workspaceMamoriRootPath, runtimeEntry);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    const sourceStats = fs.statSync(sourcePath);
    if (sourceStats.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

/**
 * 既存の `.mamori` を持つワークスペースに対して runtime を best-effort で同期する。
 * @param workspaceFolder 対象ワークスペースフォルダーを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @param outputChannel 出力チャネルを表す。
 * @returns 返り値はない。
 */
export function synchronizeExistingMamoriRuntimeIfPresent(
  workspaceFolder: vscode.WorkspaceFolder,
  extensionRootPath: string,
  outputChannel: vscode.OutputChannel,
): void {
  const workspaceMamoriRootPath = getWorkspaceMamoriRootPath(workspaceFolder);
  if (!fs.existsSync(workspaceMamoriRootPath)) {
    return;
  }

  try {
    synchronizeMamoriRuntimeToWorkspace(workspaceFolder, extensionRootPath);
  } catch (error) {
    outputChannel.appendLine(
      `Mamori Inspector could not synchronize existing workspace runtime: ${workspaceFolder.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 既存 `.mamori` を持つワークスペース群へ runtime を best-effort で同期する。
 * @param workspaceFolders 対象ワークスペース一覧を表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @param outputChannel 出力チャネルを表す。
 * @returns 返り値はない。
 */
function synchronizeExistingMamoriRuntimeForWorkspaceFolders(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  extensionRootPath: string,
  outputChannel: vscode.OutputChannel,
): void {
  for (const workspaceFolder of workspaceFolders) {
    synchronizeExistingMamoriRuntimeIfPresent(workspaceFolder, extensionRootPath, outputChannel);
  }
}

/**
 * 実行に利用する Mamori CLI パスを返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns 利用する CLI スクリプトパスを返す。
 */
function getMamoriCliPath(workspaceFolder: vscode.WorkspaceFolder, extensionRootPath: string): string {
  const workspaceCliPath = getWorkspaceMamoriCliPath(workspaceFolder);
  if (fs.existsSync(workspaceCliPath)) {
    return workspaceCliPath;
  }

  return getBundledMamoriCliPath(extensionRootPath);
}

/**
 * Mamori CLI の実行に使う親プロセスを返す。
 * @returns 実行ファイルパスを返す。
 */
function getMamoriCliExecutablePath(): string {
  const configuredExecutablePath = process.env.MAMORI_CLI_NODE_PATH;
  if (configuredExecutablePath && fs.existsSync(configuredExecutablePath)) {
    return configuredExecutablePath;
  }

  return process.execPath;
}

/**
 * Mamori CLI 失敗時に表示する詳細メッセージを返す。
 * @param stdout 標準出力を表す。
 * @param stderr 標準エラー出力を表す。
 * @param code 終了コードを表す。
 * @returns 利用者向けの失敗詳細を返す。
 */
function getMamoriCliFailureMessage(stdout: string, stderr: string, code: number | null): string {
  const normalizedStderr = stderr.trim();
  if (normalizedStderr !== '') {
    return normalizedStderr;
  }

  const normalizedStdout = stdout.trim();
  if (normalizedStdout === '') {
    return `Mamori CLI exited with code ${String(code)}`;
  }

  const errorMatch = normalizedStdout.match(/(?:^|\r?\n)\s*-\s+([^\r\n]+:error message=.+)$/mu);
  if (errorMatch && errorMatch[1]) {
    return errorMatch[1].trim();
  }

  const warningMatch = normalizedStdout.match(/(?:^|\r?\n)\s*warnings=(.+)$/mu);
  if (warningMatch && warningMatch[1]) {
    return warningMatch[1].trim();
  }

  const lines = normalizedStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.at(-1) || `Mamori CLI exited with code ${String(code)}`;
}

/**
 * ワークスペース向けの既定 SARIF パスを返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns SARIF パスを返す。
 */
function getSarifOutputPath(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): string {
  return path.join(workspaceFolder.uri.fsPath, relativePath);
}

/**
 * Mamori CLI の引数一覧を構築する。
 * @param options 実行条件を表す。
 * @returns CLI 引数一覧を返す。
 */
function buildMamoriCliArguments(options: MamoriCliRunOptions): string[] {
  const argumentsList = [
    'run',
    '--mode',
    options.mode,
    '--scope',
    options.scope,
    '--execute',
    '--sarif-output',
    options.sarifOutputPath,
  ];

  if (options.scope === 'file' && Array.isArray(options.files) && options.files.length > 0) {
    argumentsList.push('--files', options.files.join(','));
  }

  return argumentsList;
}

/**
 * Mamori hooks CLI の引数一覧を構築する。
 * @param action hooks 操作種別を表す。
 * @returns CLI 引数一覧を返す。
 */
function buildMamoriHooksArguments(action: MamoriHooksAction): string[] {
  return ['hooks', action];
}

/**
 * Mamori 保守コマンドの引数一覧を構築する。
 * @param action 保守コマンド種別を表す。
 * @returns CLI 引数一覧を返す。
 */
function buildMamoriMaintenanceArguments(action: MamoriMaintenanceAction): string[] {
  return [action];
}

/**
 * SARIF level を VS Code の重要度へ変換する。
 * @param level SARIF level を表す。
 * @returns VS Code の重要度を返す。
 */
function toDiagnosticSeverity(level: string | undefined): vscode.DiagnosticSeverity {
  switch (level) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'note':
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/**
 * SARIF finding の URI を VS Code URI へ変換する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param finding SARIF finding を表す。
 * @returns VS Code URI を返す。
 */
function toDocumentUri(workspaceFolder: vscode.WorkspaceFolder, finding: SarifFinding): vscode.Uri {
  if (path.isAbsolute(finding.uri)) {
    return vscode.Uri.file(finding.uri);
  }

  return vscode.Uri.file(path.resolve(workspaceFolder.uri.fsPath, finding.uri));
}

/**
 * Mamori CLI を実行する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns 実行完了を待つ Promise を返す。
 */
function runMamoriCli(
  workspaceFolder: vscode.WorkspaceFolder,
  options: MamoriCliRunOptions,
  extensionRootPath: string,
  events?: MamoriCliCommandEvents,
): Promise<MamoriCliCommandResult> {
  return runMamoriCliCommand(
    workspaceFolder,
    buildMamoriCliArguments(options),
    extensionRootPath,
    events,
  );
}

/**
 * 受信した出力テキストから完結した行を通知し、未完了の末尾行を返す。
 * @param pendingLine 前回チャンクから継続している末尾行を表す。
 * @param chunkText 今回受信したテキストを表す。
 * @param onLine 完結した行の通知先を表す。
 * @returns 次回へ持ち越す末尾行を返す。
 */
function emitCompletedOutputLines(
  pendingLine: string,
  chunkText: string,
  onLine?: (line: string) => void,
): string {
  const lines = `${pendingLine}${chunkText}`.split(/\r?\n/u);
  const nextPendingLine = lines.pop() || '';

  if (typeof onLine === 'function') {
    for (const line of lines) {
      onLine(line);
    }
  }

  return nextPendingLine;
}

/**
 * 子プロセス終了時に未通知の末尾行を通知する。
 * @param pendingLine 未通知の末尾行を表す。
 * @param onLine 行の通知先を表す。
 * @returns 返り値はない。
 */
function emitPendingOutputLine(
  pendingLine: string,
  onLine?: (line: string) => void,
): void {
  if (pendingLine !== '' && typeof onLine === 'function') {
    onLine(pendingLine);
  }
}

/**
 * 任意の Mamori CLI 引数を実行する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param argumentsList CLI 引数一覧を表す。
 * @returns 実行完了を待つ Promise を返す。
 */
function runMamoriCliCommand(
  workspaceFolder: vscode.WorkspaceFolder,
  argumentsList: string[],
  extensionRootPath: string,
  events?: MamoriCliCommandEvents,
): Promise<MamoriCliCommandResult> {
  const cliPath = getMamoriCliPath(workspaceFolder, extensionRootPath);
  const cliExecutablePath = getMamoriCliExecutablePath();

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(workspaceFolder.uri.fsPath)) {
      reject(new Error(`Workspace folder was not found: ${workspaceFolder.uri.fsPath}`));
      return;
    }

    if (!fs.existsSync(cliPath)) {
      reject(new Error(`Mamori CLI was not found: ${cliPath}`));
      return;
    }

    const child = spawn(
      cliExecutablePath,
      [cliPath, ...argumentsList],
      {
        cwd: workspaceFolder.uri.fsPath,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    let pendingStdoutLine = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const chunkText = chunk.toString('utf8');
      stdout += chunkText;
      pendingStdoutLine = emitCompletedOutputLines(
        pendingStdoutLine,
        chunkText,
        events?.onStdoutLine,
      );
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      emitPendingOutputLine(pendingStdoutLine, events?.onStdoutLine);

      if (typeof code === 'number' && code <= 1) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(getMamoriCliFailureMessage(stdout, stderr, code ?? null)));
    });
  });
}

/**
 * 存在するワークスペースフォルダーだけを返す。
 * @param workspaceFolders ワークスペースフォルダー一覧を表す。
 * @param outputChannel 出力チャネルを表す。
 * @returns 存在するワークスペースフォルダー一覧を返す。
 */
function filterExistingWorkspaceFolders(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  outputChannel: vscode.OutputChannel,
): vscode.WorkspaceFolder[] {
  const existingWorkspaceFolders: vscode.WorkspaceFolder[] = [];

  for (const workspaceFolder of workspaceFolders) {
    if (fs.existsSync(workspaceFolder.uri.fsPath)) {
      existingWorkspaceFolders.push(workspaceFolder);
      continue;
    }

    outputChannel.appendLine(
      `Mamori Inspector skipped missing workspace folder: ${workspaceFolder.uri.fsPath}`,
    );
  }

  return existingWorkspaceFolders;
}

/**
 * 単一ワークスペース対象の操作に使うフォルダーを返す。
 * @returns 選択されたワークスペースフォルダーを返す。
 */
async function resolveWorkspaceFolderForSingleTargetCommand(): Promise<vscode.WorkspaceFolder | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  if (workspaceFolders.length === 1) {
    return workspaceFolders[0];
  }

  const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
  if (activeDocumentUri) {
    const activeWorkspaceFolder = getWorkspaceFolderForUri(activeDocumentUri);
    if (activeWorkspaceFolder) {
      return activeWorkspaceFolder;
    }
  }

  const selectedItem = await vscode.window.showQuickPick(
    workspaceFolders.map((workspaceFolder) => ({
      label: workspaceFolder.name,
      description: workspaceFolder.uri.fsPath,
      workspaceFolder,
    })),
    {
      ignoreFocusOut: true,
      placeHolder: getWorkspaceSelectionPlaceholder(),
    },
  );

  return selectedItem?.workspaceFolder;
}

/**
 * hooks 管理コマンドを作成する。
 * @param action hooks 操作種別を表す。
 * @param outputChannel 出力チャネルを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns コマンド本体を返す。
 */
function createManageHooksCommand(
  action: MamoriHooksAction,
  outputChannel: vscode.OutputChannel,
  extensionRootPath: string,
): () => Promise<void> {
  return async() => {
    const workspaceFolder = await resolveWorkspaceFolderForSingleTargetCommand();
    if (!workspaceFolder) {
      showTransientNonErrorMessage(getOpenWorkspaceMessage());
      return;
    }

    try {
      let commandResult: MamoriCliCommandResult | undefined;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: getHooksProgressTitle(action),
          cancellable: false,
        },
        async() => {
          if (action === 'install') {
            synchronizeMamoriRuntimeToWorkspace(workspaceFolder, extensionRootPath);
          }
          commandResult = await runMamoriCliCommand(
            workspaceFolder,
            buildMamoriHooksArguments(action),
            extensionRootPath,
          );
        },
      );

      reportHooksCommandSuccess(
        action,
        commandResult ? commandResult.stdout : '',
        outputChannel,
        getTransientMessagePresenter(),
        getHooksCommandMessages(),
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
        `Mamori Inspector hooks ${action} failed: ${details}`,
      );
      void vscode.window.showErrorMessage(getHooksFailureMessage(action, details));
    }
  };
}

/**
 * setup / cache-clear 管理コマンドを作成する。
 * @param action 保守コマンド種別を表す。
 * @param outputChannel 出力チャネルを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns コマンド本体を返す。
 */
function createManageMaintenanceCommand(
  action: MamoriMaintenanceAction,
  outputChannel: vscode.OutputChannel,
  extensionRootPath: string,
): () => Promise<void> {
  return async() => {
    const workspaceFolder = await resolveWorkspaceFolderForSingleTargetCommand();
    if (!workspaceFolder) {
      showTransientNonErrorMessage(getOpenWorkspaceMessage());
      return;
    }

    const progressTitle = getMaintenanceProgressTitle(action);

    try {
      let commandResult: MamoriCliCommandResult | undefined;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: progressTitle,
          cancellable: false,
        },
        async() => {
          if (action === 'setup') {
            synchronizeMamoriRuntimeToWorkspace(workspaceFolder, extensionRootPath);
          }
          commandResult = await runMamoriCliCommand(
            workspaceFolder,
            buildMamoriMaintenanceArguments(action),
            extensionRootPath,
          );
        },
      );

      if (commandResult && commandResult.stdout.trim() !== '') {
        outputChannel.appendLine(commandResult.stdout.trim());
      }
      reportMaintenanceCommandSuccess(
        action,
        commandResult ? commandResult.stdout : '',
        getTransientMessagePresenter(),
        getMaintenanceCommandMessages(),
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
        `Mamori Inspector maintenance ${action} failed: ${details}`,
      );
      void vscode.window.showErrorMessage(getMaintenanceFailureMessage(action, details));
    }
  };
}

/**
 * SARIF の内容を URI ごとの Diagnostics へ変換する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param sarifPath SARIF パスを表す。
 * @returns URI ごとの Diagnostics 一覧を返す。
 */
function buildDiagnosticsByUri(
  workspaceFolder: vscode.WorkspaceFolder,
  sarifPath: string,
): Map<string, DiagnosticsByUriEntry> {
  const findings = loadSarifFindings(sarifPath);
  const diagnosticsByUri = new Map<string, DiagnosticsByUriEntry>();

  for (const finding of findings) {
    const documentUri = toDocumentUri(workspaceFolder, finding);
    const range = new vscode.Range(
      finding.startLine - 1,
      finding.startColumn - 1,
      finding.startLine - 1,
      finding.startColumn,
    );
    const diagnostic = new vscode.Diagnostic(
      range,
      finding.message,
      toDiagnosticSeverity(finding.level),
    );

    if (finding.ruleId) {
      diagnostic.code = finding.ruleId;
    }

    const existing = diagnosticsByUri.get(documentUri.toString()) || {
      uri: documentUri,
      diagnostics: [],
    };
    existing.diagnostics.push(diagnostic);
    diagnosticsByUri.set(documentUri.toString(), existing);
  }

  return diagnosticsByUri;
}

/**
 * URI ごとの Diagnostics を集約する。
 * @param target 集約先を表す。
 * @param source 集約元を表す。
 * @returns 返り値はない。
 */
function mergeDiagnosticsByUri(
  target: Map<string, DiagnosticsByUriEntry>,
  source: Map<string, DiagnosticsByUriEntry>,
): void {
  for (const [uriKey, entry] of source.entries()) {
    const existing = target.get(uriKey) || {
      uri: entry.uri,
      diagnostics: [],
    };
    const existingDiagnosticKeys = new Set(existing.diagnostics.map((diagnostic) => buildDiagnosticKey(diagnostic)));
    for (const diagnostic of entry.diagnostics) {
      const diagnosticKey = buildDiagnosticKey(diagnostic);
      if (existingDiagnosticKeys.has(diagnosticKey)) {
        continue;
      }
      existing.diagnostics.push(diagnostic);
      existingDiagnosticKeys.add(diagnosticKey);
    }
    target.set(uriKey, existing);
  }
}

/**
 * Diagnostics の重複判定に使うキーを返す。
 * @param diagnostic 対象 Diagnostics を表す。
 * @returns 重複判定キーを返す。
 */
function buildDiagnosticKey(diagnostic: vscode.Diagnostic): string {
  const code = typeof diagnostic.code === 'string'
    ? diagnostic.code
    : typeof diagnostic.code === 'number'
      ? String(diagnostic.code)
      : diagnostic.code && typeof diagnostic.code === 'object' && 'value' in diagnostic.code
        ? String(diagnostic.code.value)
        : '';
  return [
    diagnostic.range.start.line,
    diagnostic.range.start.character,
    diagnostic.range.end.line,
    diagnostic.range.end.character,
    diagnostic.severity,
    code,
    diagnostic.message,
  ].join(':');
}

/**
 * 対象ワークスペースの Diagnostics を保持マップから削除する。
 * @param diagnosticsByUri URI ごとの Diagnostics を表す。
 * @param workspaceFolder 対象ワークスペースフォルダーを表す。
 * @returns 返り値はない。
 */
function clearWorkspaceDiagnosticsByUri(
  diagnosticsByUri: Map<string, DiagnosticsByUriEntry>,
  workspaceFolder: vscode.WorkspaceFolder,
): void {
  for (const [uriKey, entry] of diagnosticsByUri.entries()) {
    if (getWorkspaceFolderForUri(entry.uri)?.uri.toString() === workspaceFolder.uri.toString()) {
      diagnosticsByUri.delete(uriKey);
    }
  }
}

/**
 * 対象ドキュメントの Diagnostics を保持マップから削除する。
 * @param diagnosticsByUri URI ごとの Diagnostics を表す。
 * @param documentUri 対象ドキュメント URI を表す。
 * @returns 返り値はない。
 */
function clearDocumentDiagnosticsByUri(
  diagnosticsByUri: Map<string, DiagnosticsByUriEntry>,
  documentUri: vscode.Uri,
): void {
  diagnosticsByUri.delete(documentUri.toString());
}

/**
 * 対象ワークスペースの Diagnostics を最新結果へ置き換える。
 * @param target 集約先を表す。
 * @param workspaceFolder 対象ワークスペースフォルダーを表す。
 * @param source 最新結果を表す。
 * @returns 返り値はない。
 */
function replaceWorkspaceDiagnosticsByUri(
  target: Map<string, DiagnosticsByUriEntry>,
  workspaceFolder: vscode.WorkspaceFolder,
  source: Map<string, DiagnosticsByUriEntry>,
): void {
  clearWorkspaceDiagnosticsByUri(target, workspaceFolder);
  for (const [uriKey, entry] of source.entries()) {
    target.set(uriKey, entry);
  }
}

/**
 * Diagnostics 保持状態を URI ごとにマージする。
 * @param diagnosticsState 保持状態を表す。
 * @returns マージ済み Diagnostics を返す。
 */
function buildMergedDiagnosticsByUri(
  diagnosticsState: DiagnosticsState,
): Map<string, DiagnosticsByUriEntry> {
  const mergedDiagnosticsByUri = new Map<string, DiagnosticsByUriEntry>();
  mergeDiagnosticsByUri(mergedDiagnosticsByUri, diagnosticsState.manualDiagnosticsByUri);
  mergeDiagnosticsByUri(mergedDiagnosticsByUri, diagnosticsState.saveDiagnosticsByUri);
  return mergedDiagnosticsByUri;
}

/**
 * Diagnostics 一覧の件数を数える。
 * @param diagnosticsByUri URI ごとの Diagnostics を表す。
 * @returns Diagnostics 件数を返す。
 */
function countDiagnosticsByUri(diagnosticsByUri: Map<string, DiagnosticsByUriEntry>): number {
  let diagnosticsCount = 0;
  for (const entry of diagnosticsByUri.values()) {
    diagnosticsCount += entry.diagnostics.length;
  }
  return diagnosticsCount;
}

/**
 * 集約済み Diagnostics を DiagnosticsCollection へ反映する。
 * @param diagnosticCollection 診断コレクションを表す。
 * @param diagnosticsByUri URI ごとの Diagnostics を表す。
 * @returns 反映件数を返す。
 */
function publishCollectedDiagnostics(
  diagnosticCollection: vscode.DiagnosticCollection,
  diagnosticsByUri: Map<string, DiagnosticsByUriEntry>,
): number {
  diagnosticCollection.clear();

  let totalDiagnostics = 0;
  for (const entry of diagnosticsByUri.values()) {
    diagnosticCollection.set(entry.uri, entry.diagnostics);
    totalDiagnostics += entry.diagnostics.length;
  }

  return totalDiagnostics;
}

/**
 * Diagnostics 保持状態を DiagnosticsCollection へ反映する。
 * @param diagnosticCollection 診断コレクションを表す。
 * @param diagnosticsState Diagnostics 保持状態を表す。
 * @returns 反映件数を返す。
 */
function publishTrackedDiagnostics(
  diagnosticCollection: vscode.DiagnosticCollection,
  diagnosticsState: DiagnosticsState,
): number {
  return publishCollectedDiagnostics(diagnosticCollection, buildMergedDiagnosticsByUri(diagnosticsState));
}

/**
 * 保存時 SARIF から Diagnostics を反映する。
 * @param workspaceFolder 対象ワークスペースフォルダーを表す。
 * @param documentUri 対象ドキュメント URI を表す。
 * @param sarifPath 保存時 SARIF パスを表す。
 * @param diagnosticsState Diagnostics 保持状態を表す。
 * @param diagnosticCollection 診断コレクションを表す。
 * @returns 保存時 Diagnostics 件数を返す。
 */
function publishSaveDiagnosticsFromSarif(
  workspaceFolder: vscode.WorkspaceFolder,
  documentUri: vscode.Uri,
  sarifPath: string,
  diagnosticsState: DiagnosticsState,
  diagnosticCollection: vscode.DiagnosticCollection,
): number {
  const saveDiagnosticsByUri = buildDiagnosticsByUri(workspaceFolder, sarifPath);
  clearDocumentDiagnosticsByUri(diagnosticsState.manualDiagnosticsByUri, documentUri);
  replaceWorkspaceDiagnosticsByUri(
    diagnosticsState.saveDiagnosticsByUri,
    workspaceFolder,
    saveDiagnosticsByUri,
  );
  publishTrackedDiagnostics(diagnosticCollection, diagnosticsState);
  return countDiagnosticsByUri(saveDiagnosticsByUri);
}

/**
 * 対象 URI に対応するワークスペースフォルダーを返す。
 * @param resourceUri 対象 URI を表す。
 * @returns ワークスペースフォルダーを返す。
 */
function getWorkspaceFolderForUri(resourceUri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(resourceUri);
}

/**
 * 対象ワークスペースの Mamori 設定を返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns Mamori 設定を返す。
 */
function getMamoriConfiguration(workspaceFolder: vscode.WorkspaceFolder): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(EXTENSION_CONFIGURATION_SECTION, workspaceFolder.uri);
}

/**
 * 対象ワークスペースで Mamori Inspector が有効か判定する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns 有効な場合は true を返す。
 */
function isWorkspaceEnabled(workspaceFolder: vscode.WorkspaceFolder): boolean {
  return getMamoriConfiguration(workspaceFolder).get<boolean>(ENABLED_CONFIGURATION_KEY, false);
}

/**
 * 対象ワークスペースの有効化設定を更新する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param enabled 設定する有効状態を表す。
 * @returns 更新完了を待つ Promise を返す。
 */
async function updateWorkspaceEnabledSetting(
  workspaceFolder: vscode.WorkspaceFolder,
  enabled: boolean,
): Promise<void> {
  try {
    await getMamoriConfiguration(workspaceFolder).update(
      ENABLED_CONFIGURATION_KEY,
      enabled,
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
  } catch (error) {
    if (!(error instanceof Error) || !/no resource is provided/i.test(error.message)) {
      throw error;
    }
    await updateWorkspaceEnabledSettingFile(workspaceFolder, enabled);
  }

  await waitForWorkspaceEnabledSetting(workspaceFolder, enabled);
}

/**
 * ワークスペース設定ファイルへ Mamori 有効化設定を書き込む。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param enabled 設定する有効状態を表す。
 * @returns 更新完了を待つ Promise を返す。
 */
async function updateWorkspaceEnabledSettingFile(
  workspaceFolder: vscode.WorkspaceFolder,
  enabled: boolean | undefined,
): Promise<void> {
  const settingsDirectoryPath = path.join(workspaceFolder.uri.fsPath, '.vscode');
  const settingsPath = path.join(settingsDirectoryPath, 'settings.json');
  const settings = readJsonObjectFile(settingsPath);

  if (typeof enabled === 'undefined') {
    delete settings[`${EXTENSION_CONFIGURATION_SECTION}.${ENABLED_CONFIGURATION_KEY}`];
  } else {
    settings[`${EXTENSION_CONFIGURATION_SECTION}.${ENABLED_CONFIGURATION_KEY}`] = enabled;
  }

  if (Object.keys(settings).length === 0) {
    if (fs.existsSync(settingsPath)) {
      fs.rmSync(settingsPath, { force: true });
    }
    return;
  }

  fs.mkdirSync(settingsDirectoryPath, { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/**
 * JSON オブジェクトファイルをコメント許容で読み込む。
 * @param filePath 対象ファイルパスを表す。
 * @returns 読み込んだ JSON オブジェクトを返す。
 */
function readJsonObjectFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const rawContent = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(rawContent) as Record<string, unknown>;
  } catch {
    const sanitizedContent = stripJsonComments(rawContent);
    return JSON.parse(sanitizedContent) as Record<string, unknown>;
  }
}

/**
 * JSON 文字列内を壊さずにコメントだけを除去する。
 * @param input コメントを含む JSON 文字列を表す。
 * @returns コメント除去後の JSON 文字列を返す。
 */
function stripJsonComments(input: string): string {
  let result = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let isEscaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const currentCharacter = input[index];
    const nextCharacter = index + 1 < input.length ? input[index + 1] : '';

    if (inLineComment) {
      if (currentCharacter === '\n' || currentCharacter === '\r') {
        inLineComment = false;
        result += currentCharacter;
      }
      continue;
    }

    if (inBlockComment) {
      if (currentCharacter === '*' && nextCharacter === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      result += currentCharacter;
      if (isEscaped) {
        isEscaped = false;
      } else if (currentCharacter === '\\') {
        isEscaped = true;
      } else if (currentCharacter === '"') {
        inString = false;
      }
      continue;
    }

    if (currentCharacter === '"') {
      inString = true;
      result += currentCharacter;
      continue;
    }

    if (currentCharacter === '/' && nextCharacter === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (currentCharacter === '/' && nextCharacter === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += currentCharacter;
  }

  return result;
}

/**
 * 指定したワークスペース設定値が反映されるまで待機する。
 * @param workspaceFolder 対象ワークスペースフォルダーを表す。
 * @param enabled 反映待ちの有効状態を表す。
 * @returns 反映完了を待つ Promise を返す。
 */
async function waitForWorkspaceEnabledSetting(
  workspaceFolder: vscode.WorkspaceFolder,
  enabled: boolean,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < CONFIGURATION_UPDATE_TIMEOUT_MILLISECONDS) {
    if (isWorkspaceEnabled(workspaceFolder) === enabled) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, CONFIGURATION_UPDATE_POLLING_MILLISECONDS);
    });
  }

  throw new Error(`Timed out while waiting for workspace enablement to become ${String(enabled)}`);
}

/**
 * 対象ワークスペースに属する Diagnostics を削除する。
 * @param diagnosticCollection 診断コレクションを表す。
 * @param workspaceFolder 対象ワークスペースフォルダーを表す。
 * @returns 返り値はない。
 */
function clearDiagnosticsForWorkspaceFolder(
  diagnosticsState: DiagnosticsState,
  diagnosticCollection: vscode.DiagnosticCollection,
  workspaceFolder: vscode.WorkspaceFolder,
): void {
  clearWorkspaceDiagnosticsByUri(diagnosticsState.saveDiagnosticsByUri, workspaceFolder);
  publishTrackedDiagnostics(diagnosticCollection, diagnosticsState);
}

/**
 * 保存時自動チェック対象か判定する。
 * @param document 対象ドキュメントを表す。
 * @returns 対象なら true を返す。
 */
function shouldRunAutomaticSaveCheck(document: vscode.TextDocument): boolean {
  const workspaceFolder = getWorkspaceFolderForUri(document.uri);
  return document.uri.scheme === 'file'
    && AUTO_SAVE_LANGUAGE_IDS.has(document.languageId)
    && Boolean(workspaceFolder)
    && Boolean(workspaceFolder && isWorkspaceEnabled(workspaceFolder));
}

/**
 * 実行中保存の追随再実行を許可するか判定する。
 * @param filePath 対象ファイルパスを表す。
 * @returns 追随再実行する場合は true を返す。
 */
function shouldQueueSaveCheckWhileRunning(filePath: string): boolean {
  return !AUTO_SAVE_NON_QUEUE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * 単一ファイルの保存時チェックを実行する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param filePath 対象ファイルパスを表す。
 * @param diagnosticCollection 診断コレクションを表す。
 * @param outputChannel 出力チャネルを表す。
 * @returns 実行完了を待つ Promise を返す。
 */
async function runSaveCheck(
  workspaceFolder: vscode.WorkspaceFolder,
  filePath: string,
  diagnosticsState: DiagnosticsState,
  diagnosticCollection: vscode.DiagnosticCollection,
  outputChannel: vscode.OutputChannel,
  extensionRootPath: string,
): Promise<void> {
  const sarifPath = getSarifOutputPath(workspaceFolder, SAVE_SARIF_OUTPUT);
  const documentUri = vscode.Uri.file(filePath);
  const fileName = path.basename(filePath);
  const notifiedToolIds = new Set<string>();

  fs.rmSync(sarifPath, { force: true });

  outputChannel.appendLine(`Mamori Inspector save check started for ${filePath}.`);

  try {
    await runMamoriCli(workspaceFolder, {
      mode: 'save',
      scope: 'file',
      files: [filePath],
      sarifOutputPath: sarifPath,
    }, extensionRootPath, {
      onStdoutLine: (outputLine: string) => {
        const toolId = parseSaveCheckToolStartLine(outputLine);
        if (!toolId || notifiedToolIds.has(toolId)) {
          return;
        }

        notifiedToolIds.add(toolId);
        const toolLabel = getSaveCheckToolLabel(toolId);
        outputChannel.appendLine(`Mamori Inspector save check running for ${filePath}: ${toolLabel}`);
        setTimeout(() => {
          showTransientNonErrorMessage(getSaveCheckStartStatusMessage(fileName, toolLabel));
        }, 0);
      },
    });
    if (!isWorkspaceEnabled(workspaceFolder)) {
      return;
    }

    const diagnosticsCount = publishSaveDiagnosticsFromSarif(
      workspaceFolder,
      documentUri,
      sarifPath,
      diagnosticsState,
      diagnosticCollection,
    );
    outputChannel.appendLine(
      `Mamori Inspector save check completed for ${filePath}: published ${String(diagnosticsCount)} diagnostics.`,
    );
    void vscode.window.setStatusBarMessage(
      getSaveCheckStatusMessage(diagnosticsCount),
      3000,
    );
  } catch (error) {
    outputChannel.appendLine(
      `Mamori Inspector save check failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );

    if (!isWorkspaceEnabled(workspaceFolder)) {
      return;
    }

    const diagnosticsCount = publishSaveDiagnosticsFromSarif(
      workspaceFolder,
      documentUri,
      sarifPath,
      diagnosticsState,
      diagnosticCollection,
    );
    if (diagnosticsCount > 0) {
      outputChannel.appendLine(
        `Mamori Inspector reflected ${diagnosticsCount} partial save-check diagnostics for ${filePath}.`,
      );
    }
    void vscode.window.setStatusBarMessage(
      getSaveCheckStatusMessage(diagnosticsCount),
      3000,
    );
  }
}

/**
 * ワークスペースチェックコマンドを作成する。
 * @param diagnosticCollection 診断コレクションを表す。
 * @param outputChannel 出力チャネルを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns コマンド本体を返す。
 */
function createRunWorkspaceCheckCommand(
  diagnosticsState: DiagnosticsState,
  diagnosticCollection: vscode.DiagnosticCollection,
  outputChannel: vscode.OutputChannel,
  extensionRootPath: string,
): () => Promise<void> {
  return async() => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      showTransientNonErrorMessage(getOpenWorkspaceMessage());
      return;
    }

    const existingWorkspaceFolders = filterExistingWorkspaceFolders(workspaceFolders, outputChannel);
    if (existingWorkspaceFolders.length === 0) {
      diagnosticsState.manualDiagnosticsByUri.clear();
      publishTrackedDiagnostics(diagnosticCollection, diagnosticsState);
      showTransientNonErrorMessage(getNoAvailableWorkspaceMessage());
      return;
    }

    try {
      const sarifOutputs = existingWorkspaceFolders.map((workspaceFolder) => ({
        workspaceFolder,
        sarifPath: getSarifOutputPath(workspaceFolder, MANUAL_SARIF_OUTPUT),
      }));
      showTransientNotificationToast(getWorkspaceCheckStartedMessage());
      const manualRunPromise = (async() => {
        for (const [index, sarifOutput] of sarifOutputs.entries()) {
          fs.rmSync(sarifOutput.sarifPath, { force: true });
          outputChannel.appendLine(
            `Mamori Inspector workspace check running for ${sarifOutput.workspaceFolder.name} (${String(index + 1)}/${String(sarifOutputs.length)}).`,
          );
          await runMamoriCli(sarifOutput.workspaceFolder, {
            mode: 'manual',
            scope: 'workspace',
            sarifOutputPath: sarifOutput.sarifPath,
          }, extensionRootPath);
        }
      })();
      void vscode.window.setStatusBarMessage(
        getWorkspaceCheckProgressTitle(),
        manualRunPromise,
      );
      await manualRunPromise;

      const diagnosticsByUri = new Map<string, DiagnosticsByUriEntry>();
      for (const sarifOutput of sarifOutputs) {
        mergeDiagnosticsByUri(
          diagnosticsByUri,
          buildDiagnosticsByUri(sarifOutput.workspaceFolder, sarifOutput.sarifPath),
        );
      }

      for (const sarifOutput of sarifOutputs) {
        clearWorkspaceDiagnosticsByUri(
          diagnosticsState.saveDiagnosticsByUri,
          sarifOutput.workspaceFolder,
        );
      }
      diagnosticsState.manualDiagnosticsByUri.clear();
      mergeDiagnosticsByUri(diagnosticsState.manualDiagnosticsByUri, diagnosticsByUri);
      publishTrackedDiagnostics(diagnosticCollection, diagnosticsState);
      const diagnosticsCount = countDiagnosticsByUri(diagnosticsByUri);
      showTransientNonErrorMessage(getWorkspaceCheckSuccessMessage(diagnosticsCount));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      diagnosticsState.manualDiagnosticsByUri.clear();
      publishTrackedDiagnostics(diagnosticCollection, diagnosticsState);
      outputChannel.appendLine(
        `Mamori Inspector workspace check failed: ${details}`,
      );
      void vscode.window.showErrorMessage(getWorkspaceCheckFailureMessage(details));
    }
  };
}

/**
 * ワークスペース単位の有効化コマンドを作成する。
 * @param enabled 設定する有効状態を表す。
 * @param diagnosticCollection 診断コレクションを表す。
 * @returns コマンド本体を返す。
 */
function createSetWorkspaceEnablementCommand(
  enabled: boolean,
  diagnosticsState: DiagnosticsState,
  diagnosticCollection: vscode.DiagnosticCollection,
): () => Promise<void> {
  return async() => {
    const workspaceFolder = await resolveWorkspaceFolderForSingleTargetCommand();
    if (!workspaceFolder) {
      showTransientNonErrorMessage(getOpenWorkspaceMessage());
      return;
    }

    try {
      await updateWorkspaceEnabledSetting(workspaceFolder, enabled);
      if (!enabled) {
        clearDiagnosticsForWorkspaceFolder(diagnosticsState, diagnosticCollection, workspaceFolder);
      }
      showTransientNonErrorMessage(getWorkspaceEnablementSuccessMessage(enabled, workspaceFolder.name));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(getWorkspaceEnablementFailureMessage(details));
    }
  };
}

/**
 * 拡張の初期化処理を行う。
 * @param context 拡張コンテキストを表す。
 * @returns 返り値はない。
 */
export function activate(context: vscode.ExtensionContext): void {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_COLLECTION_NAME);
  const outputChannel = vscode.window.createOutputChannel('Mamori Inspector');
  const extensionRootPath = context.extensionUri.fsPath;
  const diagnosticsState: DiagnosticsState = {
    manualDiagnosticsByUri: new Map<string, DiagnosticsByUriEntry>(),
    saveDiagnosticsByUri: new Map<string, DiagnosticsByUriEntry>(),
  };
  const saveCheckScheduler = new SaveCheckScheduler({
    debounceMilliseconds: SAVE_DEBOUNCE_MILLISECONDS,
    suppressionMilliseconds: SAVE_SUPPRESSION_MILLISECONDS,
    shouldQueueDuringRun: shouldQueueSaveCheckWhileRunning,
    executeCheck: async(filePath: string) => {
      const workspaceFolder = getWorkspaceFolderForUri(vscode.Uri.file(filePath));
      if (!workspaceFolder || !isWorkspaceEnabled(workspaceFolder)) {
        return;
      }

      await runSaveCheck(
        workspaceFolder,
        filePath,
        diagnosticsState,
        diagnosticCollection,
        outputChannel,
        extensionRootPath,
      );
    },
  });

  context.subscriptions.push(diagnosticCollection);
  context.subscriptions.push(outputChannel);
  context.subscriptions.push({
    dispose: () => saveCheckScheduler.dispose(),
  });
  synchronizeExistingMamoriRuntimeForWorkspaceFolders(
    vscode.workspace.workspaceFolders || [],
    extensionRootPath,
    outputChannel,
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.enableInWorkspace',
      createSetWorkspaceEnablementCommand(true, diagnosticsState, diagnosticCollection),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.disableInWorkspace',
      createSetWorkspaceEnablementCommand(false, diagnosticsState, diagnosticCollection),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.runWorkspaceCheck',
      createRunWorkspaceCheckCommand(
        diagnosticsState,
        diagnosticCollection,
        outputChannel,
        extensionRootPath,
      ),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.installGitHooks',
      createManageHooksCommand('install', outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.uninstallGitHooks',
      createManageHooksCommand('uninstall', outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.setupTools',
      createManageMaintenanceCommand('setup', outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.clearToolCache',
      createManageMaintenanceCommand('cache-clear', outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      synchronizeExistingMamoriRuntimeForWorkspaceFolders(
        event.added,
        extensionRootPath,
        outputChannel,
      );
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(`${EXTENSION_CONFIGURATION_SECTION}.${ENABLED_CONFIGURATION_KEY}`)) {
        return;
      }

      for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
        if (
          event.affectsConfiguration(
            `${EXTENSION_CONFIGURATION_SECTION}.${ENABLED_CONFIGURATION_KEY}`,
            workspaceFolder.uri,
          )
          && !isWorkspaceEnabled(workspaceFolder)
        ) {
          clearDiagnosticsForWorkspaceFolder(diagnosticsState, diagnosticCollection, workspaceFolder);
        }
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!shouldRunAutomaticSaveCheck(document)) {
        return;
      }
      saveCheckScheduler.schedule(document.uri.fsPath);
    }),
  );
}

/**
 * 拡張の終了処理を行う。
 * @returns 返り値はない。
 */
export function deactivate(): void {}
