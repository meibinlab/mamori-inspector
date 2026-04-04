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

/** ローカライズ埋め込み引数を表す。 */
type LocalizationArguments = Array<string | number | boolean> | Record<string, string | number | boolean>;

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
 * 手動実行が部分成功した場合の警告通知文言を返す。
 * @param diagnosticsCount 診断件数を表す。
 * @returns 警告通知文言を返す。
 */
function getWorkspaceCheckPartialSuccessMessage(diagnosticsCount: number): string {
  return localize(
    'Mamori Inspector: Reflected {0} diagnostics with partial errors. See the output channel for details.',
    'Warning message shown after a manual workspace check publishes diagnostics with partial errors.',
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
  /**
   * manual/workspace 実行で、更新済み SARIF があれば部分成功として扱うかを表す。
   */
  allowPartialResultsOnError?: boolean;
}

/**
 * Mamori CLI 実行結果を表す。
 */
interface MamoriCliCommandResult {
  /** 標準出力を表す。 */
  stdout: string;
  /** 標準エラー出力を表す。 */
  stderr: string;
  /** 終了コードを表す。 */
  exitCode: number;
  /** 部分成功時のエラー詳細を表す。 */
  partialErrorMessage?: string;
}

/**
 * 比較用のファイル状態を返す。
 * @param filePath 対象ファイルパスを表す。
 * @returns 取得できたファイル状態を返す。
 */
function getFileSnapshot(filePath: string | undefined): fs.Stats | undefined {
  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

/**
 * 実行中に結果ファイルが更新されたか判定する。
 * @param filePath 対象ファイルパスを表す。
 * @param initialSnapshot 実行前のファイル状態を表す。
 * @returns 更新されていれば true を返す。
 */
function didUpdateFile(filePath: string | undefined, initialSnapshot: fs.Stats | undefined): boolean {
  const currentSnapshot = getFileSnapshot(filePath);
  if (!currentSnapshot) {
    return false;
  }

  if (!initialSnapshot) {
    return true;
  }

  return currentSnapshot.mtimeMs !== initialSnapshot.mtimeMs
    || currentSnapshot.size !== initialSnapshot.size;
}

/**
 * Mamori CLI 実行オプションを表す。
 */
interface MamoriCliCommandExecutionOptions {
  /** manual/workspace 実行で、更新済みの結果ファイルを部分成功として扱うかを表す。 */
  allowPartialResultsOnError?: boolean;
  /** 部分成功判定に使う結果ファイルパスを表す。 */
  partialResultPath?: string;
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
 * ワークスペース直下の Mamori CLI パスを返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns CLI スクリプトパスを返す。
 */
function getWorkspaceMamoriCliPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, '.mamori', 'mamori.js');
}

/**
 * 拡張同梱の Mamori CLI パスを返す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns CLI スクリプトパスを返す。
 */
function getBundledMamoriCliPath(extensionRootPath: string): string {
  return path.join(extensionRootPath, '.mamori', 'mamori.js');
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

  const warningMatch = normalizedStdout.match(/(?:^|\r?\n)\s*warnings=(.+)$/mu);
  if (warningMatch && warningMatch[1]) {
    return warningMatch[1].trim();
  }

  const errorMatch = normalizedStdout.match(/(?:^|\r?\n)\s*-\s+([^\r\n]+:error message=.+)$/mu);
  if (errorMatch && errorMatch[1]) {
    return errorMatch[1].trim();
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
): Promise<MamoriCliCommandResult> {
  return runMamoriCliCommand(
    workspaceFolder,
    buildMamoriCliArguments(options),
    extensionRootPath,
    {
      allowPartialResultsOnError: options.allowPartialResultsOnError === true,
      partialResultPath: options.sarifOutputPath,
    },
  );
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
  executionOptions?: MamoriCliCommandExecutionOptions,
): Promise<MamoriCliCommandResult> {
  const cliPath = getMamoriCliPath(workspaceFolder, extensionRootPath);
  const cliExecutablePath = getMamoriCliExecutablePath();
  const initialPartialResultSnapshot = getFileSnapshot(executionOptions?.partialResultPath);

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

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      const exitCode = typeof code === 'number' ? code : -1;
      if (exitCode <= 1) {
        resolve({ stdout, stderr, exitCode });
        return;
      }

      const failureMessage = getMamoriCliFailureMessage(stdout, stderr, code ?? null);
      if (
        executionOptions?.allowPartialResultsOnError
        && didUpdateFile(executionOptions.partialResultPath, initialPartialResultSnapshot)
      ) {
        resolve({
          stdout,
          stderr,
          exitCode,
          partialErrorMessage: failureMessage,
        });
        return;
      }

      reject(new Error(failureMessage));
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
      void vscode.window.showWarningMessage(getOpenWorkspaceMessage());
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
        vscode.window,
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
      void vscode.window.showWarningMessage(getOpenWorkspaceMessage());
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
      void vscode.window.showInformationMessage(getMaintenanceSuccessMessage(action));
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
 * 対象 URI の Diagnostics を保持マップから削除する。
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
  await getMamoriConfiguration(workspaceFolder).update(
    ENABLED_CONFIGURATION_KEY,
    enabled,
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
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

  try {
    await runMamoriCli(workspaceFolder, {
      mode: 'save',
      scope: 'file',
      files: [filePath],
      sarifOutputPath: sarifPath,
    }, extensionRootPath);
    if (!isWorkspaceEnabled(workspaceFolder)) {
      return;
    }

    const saveDiagnosticsByUri = buildDiagnosticsByUri(workspaceFolder, sarifPath);
    clearDocumentDiagnosticsByUri(diagnosticsState.manualDiagnosticsByUri, documentUri);
    replaceWorkspaceDiagnosticsByUri(
      diagnosticsState.saveDiagnosticsByUri,
      workspaceFolder,
      saveDiagnosticsByUri,
    );
    publishTrackedDiagnostics(diagnosticCollection, diagnosticsState);
    void vscode.window.setStatusBarMessage(
      getSaveCheckStatusMessage(countDiagnosticsByUri(saveDiagnosticsByUri)),
      3000,
    );
  } catch (error) {
    outputChannel.appendLine(
      `Mamori Inspector save check failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
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
      void vscode.window.showWarningMessage(getOpenWorkspaceMessage());
      return;
    }

    const existingWorkspaceFolders = filterExistingWorkspaceFolders(workspaceFolders, outputChannel);
    if (existingWorkspaceFolders.length === 0) {
      diagnosticsState.manualDiagnosticsByUri.clear();
      publishTrackedDiagnostics(diagnosticCollection, diagnosticsState);
      void vscode.window.showWarningMessage(getNoAvailableWorkspaceMessage());
      return;
    }

    try {
      const sarifOutputs = existingWorkspaceFolders.map((workspaceFolder) => ({
        workspaceFolder,
        sarifPath: getSarifOutputPath(workspaceFolder, MANUAL_SARIF_OUTPUT),
      }));
      const partialErrorMessages: string[] = [];
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: getWorkspaceCheckProgressTitle(),
          cancellable: false,
        },
        async(progress) => {
          for (const [index, sarifOutput] of sarifOutputs.entries()) {
            progress.report({
              increment: 100 / sarifOutputs.length,
              message: `${sarifOutput.workspaceFolder.name} (${String(index + 1)}/${String(sarifOutputs.length)})`,
            });
            const commandResult = await runMamoriCli(sarifOutput.workspaceFolder, {
              mode: 'manual',
              scope: 'workspace',
              sarifOutputPath: sarifOutput.sarifPath,
              allowPartialResultsOnError: true,
            }, extensionRootPath);
            if (commandResult.partialErrorMessage) {
              partialErrorMessages.push(
                `${sarifOutput.workspaceFolder.uri.fsPath}: ${commandResult.partialErrorMessage}`,
              );
            }
          }
        },
      );

      const diagnosticsByUri = new Map<string, DiagnosticsByUriEntry>();
      for (const sarifOutput of sarifOutputs) {
        mergeDiagnosticsByUri(
          diagnosticsByUri,
          buildDiagnosticsByUri(sarifOutput.workspaceFolder, sarifOutput.sarifPath),
        );
      }

      diagnosticsState.manualDiagnosticsByUri.clear();
      mergeDiagnosticsByUri(diagnosticsState.manualDiagnosticsByUri, diagnosticsByUri);
      const diagnosticsCount = publishTrackedDiagnostics(diagnosticCollection, diagnosticsState);
      for (const partialErrorMessage of partialErrorMessages) {
        outputChannel.appendLine(
          `Mamori Inspector workspace check completed with partial errors: ${partialErrorMessage}`,
        );
      }
      if (partialErrorMessages.length > 0) {
        void vscode.window.showWarningMessage(getWorkspaceCheckPartialSuccessMessage(diagnosticsCount));
      } else {
        void vscode.window.showInformationMessage(getWorkspaceCheckSuccessMessage(diagnosticsCount));
      }
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
      void vscode.window.showWarningMessage(getOpenWorkspaceMessage());
      return;
    }

    try {
      await updateWorkspaceEnabledSetting(workspaceFolder, enabled);
      if (!enabled) {
        clearDiagnosticsForWorkspaceFolder(diagnosticsState, diagnosticCollection, workspaceFolder);
      }
      void vscode.window.showInformationMessage(
        getWorkspaceEnablementSuccessMessage(enabled, workspaceFolder.name),
      );
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
