// 断言ユーティリティを表す
import * as assert from 'assert';
// ファイルシステム API を表す
import * as fs from 'fs';
// OS 固有 API を表す
import * as os from 'os';
// パス操作 API を表す
import * as path from 'path';

/** VS Code API 型を表す。 */
type VscodeModule = typeof import('vscode');

// 保存時の SARIF 出力先を表す
const SAVE_SARIF_OUTPUT = path.join('.mamori', 'out', 'combined-save.sarif');
// 保存時統合テストの待機上限を表す
const DEFAULT_TIMEOUT_MILLISECONDS = 10000;
// 待機時のポーリング間隔を表す
const POLLING_INTERVAL_MILLISECONDS = 100;

/**
 * 条件が成立するまで待機する。
 * @param predicate 成立判定を表す。
 * @param timeoutMilliseconds タイムアウト時間を表す。
 * @returns 条件成立まで待つ Promise を返す。
 */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMilliseconds: number = DEFAULT_TIMEOUT_MILLISECONDS,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, POLLING_INTERVAL_MILLISECONDS);
    });
  }

  throw new Error(`Timed out after ${timeoutMilliseconds}ms`);
}

/**
 * 指定時間だけ待機する。
 * @param milliseconds 待機時間を表す。
 * @returns 待機完了を待つ Promise を返す。
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * VS Code API を安全に読み込む。
 * @returns 読み込めた場合は VS Code API を返す。
 */
function loadVscode(): VscodeModule | undefined {
  try {
    return require('vscode') as VscodeModule;
  } catch {
    return undefined;
  }
}

/**
 * ワークスペース基準の相対 URI を返す。
 * @param workspacePath ワークスペースパスを表す。
 * @param filePath 対象ファイルパスを表す。
 * @returns SARIF/XML 向けの相対 URI を返す。
 */
function toWorkspaceRelativeUri(workspacePath: string, filePath: string): string {
  return path.relative(workspacePath, filePath).split(path.sep).join('/');
}

/**
 * 実行可能ファイルに権限を付与する。
 * @param filePath 対象ファイルパスを表す。
 * @returns 返り値はない。
 */
function makeExecutable(filePath: string): void {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
}

/**
 * 対象ファイルの復元処理を作成する。
 * @param filePath 対象ファイルパスを表す。
 * @returns 復元関数を返す。
 */
function createRestoreAction(filePath: string): () => void {
  const existed = fs.existsSync(filePath);
  const backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mamori-restore-'));
  const backupPath = path.join(backupDirectory, path.basename(filePath));

  if (existed) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(filePath, backupPath);
  }

  return () => {
    if (existed) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.copyFileSync(backupPath, filePath);
    } else {
      fs.rmSync(filePath, { force: true });
    }
    fs.rmSync(backupDirectory, { recursive: true, force: true });
  };
}

/**
 * テスト用 Maven ラッパーを作成する。
 * @param workspacePath ワークスペースパスを表す。
 * @param logPath 実行ログパスを表す。
 * @param targetFileUri 対象ファイル URI を表す。
 * @returns 返り値はない。
 */
function writeMavenWrapper(workspacePath: string, logPath: string, targetFileUri: string): void {
  const checkstyleXml = `<?xml version="1.0"?><checkstyle version="10.0"><file name="${targetFileUri}"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>`;
  const pmdXml = `<?xml version="1.0"?><pmd version="7.0.0"><file name="${targetFileUri}"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>`;
  const wrapperPath = process.platform === 'win32'
    ? path.join(workspacePath, 'mvnw.cmd')
    : path.join(workspacePath, 'mvnw');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${logPath}"`,
        'echo %* | findstr /C:"checkstyle:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCheckstyleXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"pmd:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedPmdXml}','base64').toString('utf8'))"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${logPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:check"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * テスト用 Semgrep ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param logPath 実行ログパスを表す。
 * @param targetFileUri 対象ファイル URI を表す。
 * @returns 返り値はない。
 */
function writeSemgrepWrapper(binDirectory: string, logPath: string, targetFileUri: string): void {
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'semgrep.cmd')
    : path.join(binDirectory, 'semgrep');
  const sarif = JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'semgrep' } },
        results: [
          {
            ruleId: 'java.lang.security.audit',
            level: 'warning',
            message: { text: 'Potential issue' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: targetFileUri },
                  region: { startLine: 1, startColumn: 1 },
                },
              },
            ],
          },
        ],
      },
    ],
  });

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\necho %*>>"${logPath}"\r\necho ${sarif}\r\nexit /b 0\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${logPath}"`,
      `printf '%s\n' '${sarif}'`,
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * ログ出力専用の Web コマンドラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param commandName コマンド名を表す。
 * @param logPath 実行ログパスを表す。
 * @param stdout 実行時に標準出力へ書き出す内容を表す。
 * @param exitCode 実行終了コードを表す。
 * @returns 返り値はない。
 */
function writeWebLoggingWrapper(
  binDirectory: string,
  commandName: string,
  logPath: string,
  stdout: string = '',
  exitCode: number = 0,
): void {
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, `${commandName}.cmd`)
    : path.join(binDirectory, commandName);

  if (process.platform === 'win32') {
    const outputLines = stdout
      ? [
        'setlocal enabledelayedexpansion',
        `set MAMORI_STDOUT=${stdout.replace(/\r?\n/gu, '')}`,
        'if not "!MAMORI_STDOUT!"=="" echo !MAMORI_STDOUT!',
      ]
      : [];
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${logPath}"`,
        ...outputLines,
        `exit /b ${String(exitCode)}`,
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  const escapedStdout = stdout.replace(/'/gu, String.raw`'"'"'`);
  const outputLines = stdout
    ? [`printf '%s\n' '${escapedStdout}'`]
    : [];
  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${logPath}"`,
      ...outputLines,
      `exit ${String(exitCode)}`,
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * 整形結果をファイルへ追記する Prettier ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param logPath 実行ログパスを表す。
 * @returns 返り値はない。
 */
function writePrettierWrapper(binDirectory: string, logPath: string): void {
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'prettier.cmd')
    : path.join(binDirectory, 'prettier');

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${logPath}"`,
        'node -e "const fs=require(\'fs\');for (const value of process.argv.slice(1)) { if (value === \"--write\" || value.startsWith(\"-\")) { continue; } fs.appendFileSync(value, \"\\n// formatted by prettier\\n\"); }" %*',
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${logPath}"`,
      'for value in "$@"; do',
      '  case "$value" in',
      '    --write) continue ;;',
      '    -*) continue ;;',
      '    *) printf "\\n// formatted by prettier\\n" >> "$value" ;;',
      '  esac',
      'done',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * 保存時統合テスト用 fixture を構築する。
 * @param workspacePath ワークスペースパスを表す。
 * @returns 対象 Java ファイルと関連パスを返す。
 */
function setupSaveIntegrationFixture(workspacePath: string): {
  fixtureDirectory: string;
  javaFilePath: string;
  mavenLogPath: string;
  semgrepLogPath: string;
} {
  const fixtureDirectory = path.join(workspacePath, '.tmp-save-check');
  const sourceDirectory = path.join(fixtureDirectory, 'src', 'main', 'java');
  const binDirectory = path.join(workspacePath, 'bin');
  const javaFilePath = path.join(sourceDirectory, 'App.java');
  const javaFileUri = toWorkspaceRelativeUri(workspacePath, javaFilePath);
  const mavenLogPath = path.join(binDirectory, 'mvn.log');
  const semgrepLogPath = path.join(binDirectory, 'semgrep.log');

  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, 'pom.xml'),
    [
      '<project>',
      '  <build>',
      '    <plugins>',
      '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
      '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
      '    </plugins>',
      '  </build>',
      '</project>',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    javaFilePath,
    [
      'public class App {',
      '  void run() {}',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeMavenWrapper(workspacePath, mavenLogPath, javaFileUri);
  writeSemgrepWrapper(binDirectory, semgrepLogPath, javaFileUri);

  return {
    fixtureDirectory,
    javaFilePath,
    mavenLogPath,
    semgrepLogPath,
  };
}

/**
 * JavaScript 保存時統合テスト用 fixture を構築する。
 * @param workspacePath ワークスペースパスを表す。
 * @returns 対象 JavaScript ファイルと関連パスを返す。
 */
function setupWebSaveIntegrationFixture(workspacePath: string): {
  fixtureDirectory: string;
  javascriptFilePath: string;
  prettierLogPath: string;
  eslintLogPath: string;
} {
  const fixtureDirectory = path.join(workspacePath, '.tmp-web-save-check');
  const sourceDirectory = path.join(fixtureDirectory, 'src');
  const binDirectory = path.join(fixtureDirectory, 'node_modules', '.bin');
  const javascriptFilePath = path.join(sourceDirectory, 'main.js');
  const prettierLogPath = path.join(fixtureDirectory, 'prettier.log');
  const eslintLogPath = path.join(fixtureDirectory, 'eslint.log');
  const eslintOutput = JSON.stringify([
    {
      filePath: javascriptFilePath,
      messages: [
        {
          ruleId: 'no-console',
          severity: 2,
          message: 'Unexpected console statement.',
          line: 2,
          column: 1,
        },
      ],
    },
  ]);

  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.writeFileSync(path.join(fixtureDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
  fs.writeFileSync(javascriptFilePath, 'const sample = 1;\n', 'utf8');
  writePrettierWrapper(binDirectory, prettierLogPath);
  writeWebLoggingWrapper(binDirectory, 'eslint', eslintLogPath, eslintOutput, 1);

  return {
    fixtureDirectory,
    javascriptFilePath,
    prettierLogPath,
    eslintLogPath,
  };
}

/**
 * Git hooks 統合テスト用の復元処理を返す。
 * @param workspacePath ワークスペースパスを表す。
 * @returns hook パスと復元関数を返す。
 */
function setupHooksFixture(workspacePath: string): {
  preCommitHookPath: string;
  prePushHookPath: string;
  restorePreCommitHook: () => void;
  restorePrePushHook: () => void;
} {
  const hooksDirectory = path.join(workspacePath, '.git', 'hooks');
  const preCommitHookPath = path.join(hooksDirectory, 'pre-commit');
  const prePushHookPath = path.join(hooksDirectory, 'pre-push');

  fs.mkdirSync(hooksDirectory, { recursive: true });

  return {
    preCommitHookPath,
    prePushHookPath,
    restorePreCommitHook: createRestoreAction(preCommitHookPath),
    restorePrePushHook: createRestoreAction(prePushHookPath),
  };
}

/**
 * Mamori Inspector 拡張を取得する。
 * @returns 拡張情報を返す。
 */
function getMamoriExtension(vscodeApi: VscodeModule): VscodeModule['extensions']['all'][number] {
  const extension = vscodeApi.extensions.all.find(
    (candidate) => candidate.packageJSON.name === 'mamori-inspector',
  );
  if (!extension) {
    throw new Error('Mamori Inspector extension was not found');
  }
  return extension;
}

/**
 * 拡張のテストスイートを定義する。
 * @returns 返り値はない。
 */
suite('Extension Test Suite', () => {
  /** 現在利用する VS Code API を表す。 */
  let vscodeApi: VscodeModule | undefined;
  /** 元の PATH を表す。 */
  let originalPath = '';

  /**
   * 各テストの前処理を行う。
   * @returns 実行完了を待つ Promise を返す。
   */
  setup(async() => {
    vscodeApi = loadVscode();
    originalPath = process.env.PATH || '';
  });

  /**
   * 各テストの後処理を行う。
   * @returns 実行完了を待つ Promise を返す。
   */
  teardown(async() => {
    process.env.PATH = originalPath;
  });

  /**
   * サンプルテストを実行する。
   * @returns 返り値はない。
   */
  test('Sample test', () => {
    // 配列に含まれない値を表す
    const missing = -1;
    assert.strictEqual(missing, [1, 2, 3].indexOf(5));
    assert.strictEqual(missing, [1, 2, 3].indexOf(0));
  });

  /**
   * Java ファイル保存時に Mamori CLI が自動実行され、Diagnostics に反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Runs save checks and publishes diagnostics when a Java file is saved', async function() {
    this.timeout(20000);

    if (!vscodeApi) {
      this.skip();
      return;
    }
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);

      process.env.PATH = `${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`;

      try {
        const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(javaFilePath));
        await activeVscodeApi.window.showTextDocument(document);
        await getMamoriExtension(activeVscodeApi).activate();

        const editor = activeVscodeApi.window.activeTextEditor;
        if (!editor) {
          throw new Error('Active text editor was not found');
        }

        await editor.edit((editBuilder) => {
          editBuilder.insert(new activeVscodeApi.Position(1, 0), '  int value = 1;\n');
        });
        await document.save();

        await waitFor(() => fs.existsSync(saveSarifPath));
        await waitFor(() => fs.existsSync(mavenLogPath) && fs.existsSync(semgrepLogPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length === 3);

        const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath));
        const messages = diagnostics.map((diagnostic) => diagnostic.message);

        assert.strictEqual(diagnostics.length, 3);
        assert.ok(messages.includes('Missing Javadoc'));
        assert.ok(messages.includes('Unused local variable'));
        assert.ok(messages.includes('Potential issue'));
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /checkstyle:check/u);
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /pmd:check/u);
        assert.match(fs.readFileSync(semgrepLogPath, 'utf8'), /App\.java/u);
        assert.ok(fs.existsSync(saveSarifPath));
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreSaveSarif();
    }
  });

  /**
   * JavaScript ファイル保存時に Web 系の保存時 finding が Diagnostics へ反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Runs save checks when a JavaScript file is saved', async function() {
    this.timeout(20000);

    if (!vscodeApi) {
      this.skip();
      return;
    }
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      const {
        fixtureDirectory,
        javascriptFilePath,
        prettierLogPath,
        eslintLogPath,
      } = setupWebSaveIntegrationFixture(workspaceRoot);
      const restorePrettierLog = createRestoreAction(prettierLogPath);
      const restoreEslintLog = createRestoreAction(eslintLogPath);

      try {
        const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(javascriptFilePath));
        await activeVscodeApi.window.showTextDocument(document);
        await getMamoriExtension(activeVscodeApi).activate();

        const editor = activeVscodeApi.window.activeTextEditor;
        if (!editor) {
          throw new Error('Active text editor was not found');
        }

        await editor.edit((editBuilder) => {
          editBuilder.insert(new activeVscodeApi.Position(1, 0), 'console.log(sample);\n');
        });
        await document.save();

        await waitFor(() => fs.existsSync(saveSarifPath));
        await waitFor(() => fs.existsSync(prettierLogPath) && fs.existsSync(eslintLogPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javascriptFilePath)).length === 1);

        const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javascriptFilePath));

        assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /--write/u);
        assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /main\.js/u);
        assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /main\.js/u);
        assert.ok(fs.existsSync(saveSarifPath));
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, 'Unexpected console statement.');
        assert.match(fs.readFileSync(saveSarifPath, 'utf8'), /Unexpected console statement\./u);
      } finally {
        restorePrettierLog();
        restoreEslintLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restoreSaveSarif();
    }
  });

  /**
   * Java 以外のファイル保存では Mamori CLI が自動実行されないこと。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Does not run save checks when a non-Java file is saved', async function() {
    this.timeout(20000);

    if (!vscodeApi) {
      this.skip();
      return;
    }
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const fixtureDirectory = path.join(workspaceRoot, '.tmp-save-check-ignored');
    const sourceDirectory = path.join(fixtureDirectory, 'src', 'main', 'resources');
    const textFilePath = path.join(sourceDirectory, 'notes.txt');
    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const mavenLogPath = path.join(workspaceRoot, 'bin', 'mvn.log');
    const semgrepLogPath = path.join(workspaceRoot, 'bin', 'semgrep.log');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreMavenLog = createRestoreAction(mavenLogPath);
    const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.mkdirSync(sourceDirectory, { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, 'bin'), { recursive: true });
      fs.writeFileSync(
        pomFilePath,
        [
          '<project>',
          '  <build>',
          '    <plugins>',
          '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
          '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
          '    </plugins>',
          '  </build>',
          '</project>',
          '',
        ].join('\n'),
        'utf8',
      );
      writeMavenWrapper(workspaceRoot, mavenLogPath, 'src/main/java/App.java');
      writeSemgrepWrapper(path.join(workspaceRoot, 'bin'), semgrepLogPath, 'src/main/java/App.java');
      fs.writeFileSync(
        textFilePath,
        ['memo', 'updated', ''].join('\n'),
        'utf8',
      );

      const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(textFilePath));
      await activeVscodeApi.window.showTextDocument(document);
      await getMamoriExtension(activeVscodeApi).activate();

      const editor = activeVscodeApi.window.activeTextEditor;
      if (!editor) {
        throw new Error('Active text editor was not found');
      }

      await editor.edit((editBuilder) => {
        editBuilder.insert(new activeVscodeApi.Position(1, 0), 'ignored\n');
      });
      await document.save();
      await delay(1500);

      assert.strictEqual(activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(textFilePath)).length, 0);
      assert.ok(!fs.existsSync(saveSarifPath));
      assert.ok(!fs.existsSync(mavenLogPath));
      assert.ok(!fs.existsSync(semgrepLogPath));
    } finally {
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreMavenLog();
      restoreSemgrepLog();
      restoreSaveSarif();
    }
  });

  /**
   * Git hooks コマンドで pre-commit と pre-push を作成できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Installs and uninstalls Git hooks from extension commands', async function() {
    this.timeout(20000);

    if (!vscodeApi) {
      this.skip();
      return;
    }

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const {
      preCommitHookPath,
      prePushHookPath,
      restorePreCommitHook,
      restorePrePushHook,
    } = setupHooksFixture(workspaceRoot);

    try {
      await getMamoriExtension(activeVscodeApi).activate();

      await activeVscodeApi.commands.executeCommand('mamori-inspector.installGitHooks');
      await waitFor(() => fs.existsSync(preCommitHookPath) && fs.existsSync(prePushHookPath));

      assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /mamori-inspector-managed-hook/u);
      assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /--mode precommit --scope staged --execute/u);
      assert.match(fs.readFileSync(prePushHookPath, 'utf8'), /--mode prepush --scope workspace --execute/u);

      await activeVscodeApi.commands.executeCommand('mamori-inspector.uninstallGitHooks');
      await waitFor(() => !fs.existsSync(preCommitHookPath) && !fs.existsSync(prePushHookPath));
    } finally {
      restorePreCommitHook();
      restorePrePushHook();
    }
  });

  /**
   * 未管理の既存 hook がある場合は保持したまま install を継続できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Keeps unmanaged hooks unchanged when install command encounters conflicts', async function() {
    this.timeout(20000);

    if (!vscodeApi) {
      this.skip();
      return;
    }

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const {
      preCommitHookPath,
      prePushHookPath,
      restorePreCommitHook,
      restorePrePushHook,
    } = setupHooksFixture(workspaceRoot);

    try {
      fs.writeFileSync(preCommitHookPath, '#!/bin/sh\necho custom hook\n', 'utf8');
      await getMamoriExtension(activeVscodeApi).activate();

      await activeVscodeApi.commands.executeCommand('mamori-inspector.installGitHooks');
      await waitFor(() => fs.existsSync(prePushHookPath));

      assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /custom hook/u);
      assert.doesNotMatch(fs.readFileSync(preCommitHookPath, 'utf8'), /mamori-inspector-managed-hook/u);
      assert.match(fs.readFileSync(prePushHookPath, 'utf8'), /mamori-inspector-managed-hook/u);
    } finally {
      restorePreCommitHook();
      restorePrePushHook();
    }
  });
});
