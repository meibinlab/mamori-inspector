// 断言ユーティリティを表す
import * as assert from 'assert';
// 子プロセス実行 API を表す
import { spawnSync } from 'child_process';
// ファイルシステム API を表す
import * as fs from 'fs';
// OS 固有 API を表す
import * as os from 'os';
// パス操作 API を表す
import * as path from 'path';

/**
 * Mamori CLI の実行結果を表す。
 */
interface MamoriCliResult {
  /** 実行時の終了コードを表す。 */
  status: number | null;
  /** 標準出力を表す。 */
  stdout: string;
  /** 標準エラー出力を表す。 */
  stderr: string;
}

/**
 * CLI 実行オプションを表す。
 */
interface MamoriCliOptions {
  /** 実行環境変数を表す。 */
  env?: NodeJS.ProcessEnv;
}

/**
 * テスト用一時ディレクトリを作成する。
 * @returns 作成した一時ディレクトリの絶対パスを返す。
 */
function createTemporaryDirectory(): string {
  // 一時ディレクトリの接頭辞を表す
  const prefix = path.join(os.tmpdir(), 'mamori-cli-');
  return fs.mkdtempSync(prefix);
}

/**
 * Mamori CLI を実行する。
 * @param workingDirectory 実行時の作業ディレクトリを表す。
 * @param argumentsList コマンド引数一覧を表す。
 * @returns 実行結果を返す。
 */
function runMamoriCli(
  workingDirectory: string,
  argumentsList: string[],
  options: MamoriCliOptions = {},
): MamoriCliResult {
  // コンパイル後のテストファイルから見たリポジトリルートを表す
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  // CLI スクリプトの絶対パスを表す
  const cliScriptPath = path.join(repositoryRoot, '.mamori', 'mamori.js');
  // 子プロセス実行結果を表す
  const result = spawnSync(process.execPath, [cliScriptPath, ...argumentsList], {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: options.env,
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * テスト用のコマンドラッパーディレクトリを作成する。
 * @param workingDirectory 作業ディレクトリを表す。
 * @returns ラッパーディレクトリの絶対パスを返す。
 */
function createCommandBinDirectory(workingDirectory: string): string {
  const binDirectory = path.join(workingDirectory, 'bin');
  fs.mkdirSync(binDirectory, { recursive: true });
  return binDirectory;
}

/**
 * テスト用の node_modules/.bin ディレクトリを作成する。
 * @param workingDirectory 作業ディレクトリを表す。
 * @returns ラッパーディレクトリの絶対パスを返す。
 */
function createNodeModulesBinDirectory(workingDirectory: string): string {
  const binDirectory = path.join(workingDirectory, 'node_modules', '.bin');
  fs.mkdirSync(binDirectory, { recursive: true });
  return binDirectory;
}

/**
 * テスト用 PATH を構築する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @returns PATH 文字列を返す。
 */
function buildTestPath(binDirectory: string): string {
  return `${binDirectory}${path.delimiter}${process.env.PATH || ''}`;
}

/**
 * テスト用の Windows コマンドラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param commandName コマンド名を表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeCommandWrapper(binDirectory: string, commandName: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, `${commandName}.cmd`)
    : path.join(binDirectory, commandName);

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\necho %*>>"${outputPath}"\r\nexit /b 0\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nprintf '%s\n' "$*" >> "${outputPath}"\nexit 0\n`,
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Web ツール向けコマンドラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param commandName コマンド名を表す。
 * @param outputFileName 出力ファイル名を表す。
 * @param options ラッパー動作オプションを表す。
 * @returns 返り値はない。
 */
function writeWebCommandWrapper(
  binDirectory: string,
  commandName: string,
  outputFileName: string,
  options: {
    formattedFilePath?: string;
    stdout?: string;
    exitCode?: number;
  } = {},
): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, `${commandName}.cmd`)
    : path.join(binDirectory, commandName);
  const stdout = typeof options.stdout === 'string' ? options.stdout : '';
  const exitCode = typeof options.exitCode === 'number' ? options.exitCode : 0;
  const encodedStdout = Buffer.from(stdout, 'utf8').toString('base64');

  if (process.platform === 'win32') {
    const lines = [
      '@echo off',
      `echo %*>>"${outputPath}"`,
    ];

    if (options.formattedFilePath) {
      lines.push(`>>"${options.formattedFilePath}" echo // formatted by ${commandName}`);
    }

    if (stdout) {
      lines.push(`node -e "process.stdout.write(Buffer.from('${encodedStdout}','base64').toString('utf8'))"`);
    }

    lines.push(`exit /b ${String(exitCode)}`, '');
    fs.writeFileSync(wrapperPath, lines.join('\r\n'), 'utf8');
    return;
  }

  const lines = [
    '#!/bin/sh',
    `printf '%s\n' "$*" >> "${outputPath}"`,
  ];

  if (options.formattedFilePath) {
    lines.push(`printf '%s\n' '// formatted by ${commandName}' >> '${options.formattedFilePath}'`);
  }

  if (stdout) {
    lines.push(`node -e "process.stdout.write(Buffer.from('${encodedStdout}','base64').toString('utf8'))"`);
  }

  lines.push(`exit ${String(exitCode)}`, '');
  fs.writeFileSync(wrapperPath, lines.join('\n'), 'utf8');
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Maven 実行結果を返すテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeMavenIssueWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>';
  const pmdXml = '<?xml version="1.0"?><pmd version="7.0.0"><file name="src/main/java/App.java"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
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
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:check"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-commit の Git 再ステージ検証向け Maven ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @param formattedFilePath 整形対象ファイルパスを表す。
 * @returns 返り値はない。
 */
function writeMavenPrecommitGitWrapper(
  binDirectory: string,
  outputFileName: string,
  formattedFilePath: string,
): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>';
  const pmdXml = '<?xml version="1.0"?><pmd version="7.0.0"><file name="src/main/java/App.java"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"spotless:apply" >nul',
        `if not errorlevel 1 >>"${formattedFilePath}" echo // formatted by spotless`,
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
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"spotless:apply"*) printf '%s\n' '// formatted by spotless' >> '${formattedFilePath}' ;;`,
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:check"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-commit 検証向けの Git ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @param stagedFilePath ステージ済みファイルのワークスペース相対パスを表す。
 * @param stagedFileAbsolutePath ステージ済みファイルの絶対パスを表す。
 * @param indexSnapshotPath 再ステージ済み内容の退避先を表す。
 * @returns 返り値はない。
 */
function writeGitPrecommitWrapper(
  binDirectory: string,
  outputFileName: string,
  stagedFilePath: string,
  stagedFileAbsolutePath: string,
  indexSnapshotPath: string,
): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const normalizedStagedFilePath = stagedFilePath.split(path.sep).join('/');
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'git.cmd')
    : path.join(binDirectory, 'git');

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"diff --cached --name-only --diff-filter=ACMR" >nul',
        `if not errorlevel 1 echo ${normalizedStagedFilePath}`,
        'echo %* | findstr /C:"diff --cached --name-only --diff-filter=ACMR" >nul',
        'if not errorlevel 1 exit /b 0',
        'echo %* | findstr /C:"add --" >nul',
        `if not errorlevel 1 node -e "const fs=require('fs');const path=require('path');fs.mkdirSync(path.dirname(process.argv[2]),{recursive:true});fs.copyFileSync(process.argv[1], process.argv[2]);" "${stagedFileAbsolutePath}" "${indexSnapshotPath}"`,
        'echo %* | findstr /C:"add --" >nul',
        'if not errorlevel 1 exit /b 0',
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
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"diff --cached --name-only --diff-filter=ACMR"*) printf '%s\n' '${normalizedStagedFilePath}' ;;`,
      `  *"add --"*) mkdir -p '${path.dirname(indexSnapshotPath)}' && cp '${stagedFileAbsolutePath}' '${indexSnapshotPath}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Gradle 実行結果を返すテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeGradleIssueWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="4" column="3" severity="warning" message="Gradle Checkstyle finding" source="com.puppycrawl.tools.checkstyle.checks.naming.MemberNameCheck"/></file></checkstyle>';
  const pmdXml = '<?xml version="1.0"?><pmd version="7.0.0"><file name="src/main/java/App.java"><violation beginline="5" begincolumn="7" priority="2" rule="AvoidDuplicateLiterals">Gradle PMD finding</violation></file></pmd>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'gradlew.bat')
    : path.join(path.dirname(binDirectory), 'gradlew');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"checkstyleMain" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCheckstyleXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"pmdMain" >nul',
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
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"checkstyleMain"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmdMain"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-push 向け Gradle 実行結果を返すテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeGradlePrepushWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const cpdXml = '<?xml version="1.0"?><pmd-cpd><duplication lines="8" tokens="52"><file path="src/main/java/App.java" line="10"/><file path="src/main/java/Other.java" line="18"/></duplication></pmd-cpd>';
  const spotbugsXml = '<?xml version="1.0"?><BugCollection><BugInstance type="DLS_DEAD_LOCAL_STORE" priority="3"><LongMessage>Dead store to local variable</LongMessage><Class classname="App"/><SourceLine classname="App" sourcepath="src/main/java/App.java" start="21"/></BugInstance></BugCollection>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'gradlew.bat')
    : path.join(path.dirname(binDirectory), 'gradlew');

  if (process.platform === 'win32') {
    const encodedCpdXml = Buffer.from(cpdXml, 'utf8').toString('base64');
    const encodedSpotbugsXml = Buffer.from(spotbugsXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"cpdCheck" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCpdXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"spotbugsMain" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedSpotbugsXml}','base64').toString('utf8'))"`,
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
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"cpdCheck"*) printf '%s' '${cpdXml}' ;;`,
      `  *"spotbugsMain"*) printf '%s' '${spotbugsXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-push 向け Maven 実行結果を返すテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeMavenPrepushWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const cpdXml = '<?xml version="1.0"?><pmd-cpd><duplication lines="6" tokens="40"><file path="src/main/java/App.java" line="8"/><file path="src/main/java/Other.java" line="12"/></duplication></pmd-cpd>';
  const spotbugsXml = '<?xml version="1.0"?><BugCollection><BugInstance type="NP_NULL_ON_SOME_PATH" priority="2"><LongMessage>Possible null pointer dereference</LongMessage><Class classname="App"/><SourceLine classname="App" sourcepath="src/main/java/App.java" start="14"/></BugInstance></BugCollection>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');

  if (process.platform === 'win32') {
    const encodedCpdXml = Buffer.from(cpdXml, 'utf8').toString('base64');
    const encodedSpotbugsXml = Buffer.from(spotbugsXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"pmd:cpd-check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCpdXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"spotbugs:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedSpotbugsXml}','base64').toString('utf8'))"`,
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
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"pmd:cpd-check"*) printf '%s' '${cpdXml}' ;;`,
      `  *"spotbugs:check"*) printf '%s' '${spotbugsXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Semgrep 用の SARIF 出力ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeSemgrepSarifWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
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
                  artifactLocation: { uri: 'src/main/java/App.java' },
                  region: { startLine: 1, startColumn: 1 },
                },
              },
            ],
          },
        ],
      },
    ],
  });
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'semgrep.cmd')
    : path.join(binDirectory, 'semgrep');

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\necho %*>>"${outputPath}"\r\necho ${sarif}\r\nexit /b 0\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      `printf '%s\n' '${sarif}'`,
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Mamori CLI のテストスイートを定義する。
 * @returns 返り値はない。
 */
suite('Mamori CLI Test Suite', () => {
  /**
   * 不正な mode を拒否すること。
   * @returns 返り値はない。
   */
  test('Rejects an invalid mode', () => {
    // CLI 実行結果を表す
    const result = runMamoriCli(process.cwd(), [
      'run',
      '--mode',
      'bogus',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /invalid mode: bogus/u);
  });

  /**
   * file scope では files が必須であること。
   * @returns 返り値はない。
   */
  test('Requires files for file scope', () => {
    // CLI 実行結果を表す
    const result = runMamoriCli(process.cwd(), [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
    ]);

    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /scope=file requires --files/u);
  });

  /**
   * save/file では対象ファイル起点で最寄り設定を探索すること。
   * @returns 返り値はない。
   */
  test('Discovers the nearest ESLint configuration from the target file', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // 対象モジュールディレクトリを表す
    const moduleDirectory = path.join(temporaryDirectory, 'packages', 'app');
    // ソースディレクトリを表す
    const sourceDirectory = path.join(moduleDirectory, 'src');
    // 対象ファイルパスを表す
    const targetFilePath = path.join(sourceDirectory, 'main.ts');
    // 設定ファイルパスを表す
    const eslintConfigPath = path.join(moduleDirectory, 'eslint.config.ts');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'export const sample = 1;\n', 'utf8');
    fs.writeFileSync(eslintConfigPath, 'export default [];\n', 'utf8');

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /source=discovery/u);
    assert.match(result.stdout, /eslint\.config\.ts/u);
  });

  /**
   * save/file で Web 系ツールが拡張子ごとに分離された command plan を構築すること。
   * @returns 返り値はない。
   */
  test('Builds save command plans for web files with tool-specific targets', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');
    const styleDirectory = path.join(temporaryDirectory, 'styles');
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const javascriptFilePath = path.join(scriptDirectory, 'main.js');
    const cssFilePath = path.join(styleDirectory, 'site.css');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.mkdirSync(styleDirectory, { recursive: true });
    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(javascriptFilePath, 'const sample = 1;\n', 'utf8');
    fs.writeFileSync(cssFilePath, 'body { color: black; }\n', 'utf8');
    fs.writeFileSync(htmlFilePath, '<!doctype html>\n<html></html>\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {};\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tagname-lowercase": true}\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      [
        path.relative(temporaryDirectory, javascriptFilePath),
        path.relative(temporaryDirectory, cssFilePath),
        path.relative(temporaryDirectory, htmlFilePath),
      ].join(','),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /formatters=prettier:enabled/u);
    assert.match(result.stdout, /checks=eslint:enabled, stylelint:enabled, htmlhint:enabled/u);

    const prettierLine = result.stdout.match(/prettier:prettier[^\n]*/u);
    const eslintLine = result.stdout.match(/eslint:eslint[^,\n]*/u);
    const stylelintLine = result.stdout.match(/stylelint:stylelint[^,\n]*/u);
    const htmlhintLine = result.stdout.match(/htmlhint:htmlhint[^\n]*/u);

    assert.ok(prettierLine);
    assert.ok(eslintLine);
    assert.ok(stylelintLine);
    assert.ok(htmlhintLine);
    assert.match(prettierLine ? prettierLine[0] : '', /main\.js/u);
    assert.match(prettierLine ? prettierLine[0] : '', /site\.css/u);
    assert.match(prettierLine ? prettierLine[0] : '', /index\.html/u);
    assert.match(eslintLine ? eslintLine[0] : '', /main\.js/u);
    assert.doesNotMatch(eslintLine ? eslintLine[0] : '', /site\.css|index\.html/u);
    assert.match(stylelintLine ? stylelintLine[0] : '', /site\.css/u);
    assert.doesNotMatch(stylelintLine ? stylelintLine[0] : '', /main\.js|index\.html/u);
    assert.match(htmlhintLine ? htmlhintLine[0] : '', /index\.html/u);
    assert.doesNotMatch(htmlhintLine ? htmlhintLine[0] : '', /main\.js|site\.css/u);
  });

  /**
   * 明示指定がある場合は Semgrep の既定値より優先されること。
   * @returns 返り値はない。
   */
  test('Prefers explicit Semgrep rules over defaults', () => {
    // CLI 実行結果を表す
    const result = runMamoriCli(process.cwd(), [
      'run',
      '--mode',
      'manual',
      '--scope',
      'workspace',
      '--semgrep-rule',
      'custom/rule',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /semgrep: enabled \(source=explicit\)/u);
    assert.match(result.stdout, /rules=custom\/rule/u);
  });

  /**
   * 存在しない対象ファイルを安全に拒否すること。
   * @returns 返り値はない。
   */
  test('Rejects a missing target file safely', () => {
    // CLI 実行結果を表す
    const result = runMamoriCli(process.cwd(), [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      'does-not-exist/main.ts',
    ]);

    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /file not found: does-not-exist[\\/]main\.ts/u);
  });

  /**
   * pre-commit の staged 解決では Git CLI が必要であること。
   * @returns 返り値はない。
   */
  test('Reports a clear error when git is unavailable for precommit staged resolution', () => {
    const temporaryDirectory = createTemporaryDirectory();

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
      ],
      {
        env: {
          ...process.env,
          PATH: '',
        },
      },
    );

    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /git CLI was not found in PATH/u);
  });

  /**
   * 退避ファイルを有効設定として誤検知しないこと。
   * @returns 返り値はない。
   */
  test('Ignores backup-like configuration filenames', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // 対象ファイルの親ディレクトリを表す
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    // 対象ファイルパスを表す
    const targetFilePath = path.join(sourceDirectory, 'main.ts');
    // 退避ファイルパスを表す
    const backupConfigPath = path.join(temporaryDirectory, 'eslint.config.backup');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'export const sample = 1;\n', 'utf8');
    fs.writeFileSync(backupConfigPath, 'ignored\n', 'utf8');

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /eslint\.config\.backup/u);
    assert.match(result.stdout, /eslint: disabled \(source=default\)/u);
  });

  /**
   * 設定未検出時は Web checker を skip として計画すること。
   * @returns 返り値はない。
   */
  test('Skips web checkers when configuration is not detected', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');
    const styleDirectory = path.join(temporaryDirectory, 'styles');
    const htmlDirectory = path.join(temporaryDirectory, 'public');

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.mkdirSync(styleDirectory, { recursive: true });
    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(path.join(scriptDirectory, 'main.js'), 'const sample = 1;\n', 'utf8');
    fs.writeFileSync(path.join(styleDirectory, 'site.css'), 'body { color: black; }\n', 'utf8');
    fs.writeFileSync(path.join(htmlDirectory, 'index.html'), '<!doctype html>\n<html></html>\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /mamori: execution-plan\n  - none/u);
    assert.doesNotMatch(result.stdout, /mamori: command-plan\n  - none/u);
    assert.match(result.stdout, /eslint:disabled reason=config-not-detected/u);
    assert.match(result.stdout, /stylelint:disabled reason=config-not-detected/u);
    assert.match(result.stdout, /htmlhint:disabled reason=config-not-detected/u);
  });

  /**
   * Web 専用ワークスペースでも plan が空にならないこと。
   * @returns 返り値はない。
   */
  test('Keeps execution and command plans non-empty for web-only workspaces', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.writeFileSync(path.join(scriptDirectory, 'main.js'), 'const sample = 1;\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-plan/u);
    assert.match(result.stdout, /workspace:/u);
    assert.match(result.stdout, /mamori: command-plan/u);
    assert.doesNotMatch(result.stdout, /mamori: execution-plan\n  - none/u);
    assert.doesNotMatch(result.stdout, /mamori: command-plan\n  - none/u);
  });

  /**
   * workspace scope でもネストした Web 設定を module 単位で解決できること。
   * @returns 返り値はない。
   */
  test('Builds workspace web modules from nested configuration roots', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const moduleDirectory = path.join(temporaryDirectory, 'packages', 'app');
    const sourceDirectory = path.join(moduleDirectory, 'src');
    const targetFilePath = path.join(sourceDirectory, 'main.js');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'const sample = 1;\n', 'utf8');
    fs.writeFileSync(path.join(moduleDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /packages[\\/]app/u);
    assert.match(result.stdout, /checks=eslint:enabled/u);
    assert.match(result.stdout, /commands=eslint:eslint/u);
  });

  /**
   * pre-push の Web checker 失敗時に issue を SARIF 化して gate できること。
   * @returns 返り値はない。
   */
  test('Fails prepush when web checkers report findings and writes SARIF issues', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');
    const styleDirectory = path.join(temporaryDirectory, 'styles');
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-web-prepush.sarif');
    const javascriptFilePath = path.join(scriptDirectory, 'main.js');
    const cssFilePath = path.join(styleDirectory, 'site.css');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const eslintOutput = JSON.stringify([
      {
        filePath: javascriptFilePath,
        messages: [
          {
            ruleId: 'no-console',
            severity: 2,
            message: 'Unexpected console statement.',
            line: 1,
            column: 1,
          },
        ],
      },
    ]);
    const stylelintOutput = JSON.stringify([
      {
        source: cssFilePath,
        warnings: [
          {
            line: 1,
            column: 8,
            rule: 'color-no-invalid-hex',
            severity: 'error',
            text: 'Unexpected invalid hex color "#12" (color-no-invalid-hex)',
          },
        ],
      },
    ]);
    const htmlhintOutput = JSON.stringify([
      {
        file: htmlFilePath,
        messages: [
          {
            type: 'warning',
            message: 'Tag must be paired.',
            line: 2,
            col: 3,
            rule: { id: 'tag-pair' },
          },
        ],
      },
    ]);

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.mkdirSync(styleDirectory, { recursive: true });
    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(javascriptFilePath, 'console.log("sample");\n', 'utf8');
    fs.writeFileSync(cssFilePath, 'body { color: #12; }\n', 'utf8');
    fs.writeFileSync(htmlFilePath, '<!doctype html>\n<div>\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {};\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log', { stdout: eslintOutput, exitCode: 1 });
    writeWebCommandWrapper(nodeBinDirectory, 'stylelint', 'stylelint.log', { stdout: stylelintOutput, exitCode: 2 });
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: htmlhintOutput, exitCode: 1 });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /Unexpected console statement\./u);
    assert.match(result.stdout, /Unexpected invalid hex color/u);
    assert.match(result.stdout, /Tag must be paired\./u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /no-console/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /color-no-invalid-hex/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /tag-pair/u);
  });

  /**
   * Git hooks をインストールできること。
   * @returns 返り値はない。
   */
  test('Installs managed pre-commit and pre-push hooks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const hooksDirectory = path.join(temporaryDirectory, '.git', 'hooks');
    const preCommitHookPath = path.join(hooksDirectory, 'pre-commit');
    const prePushHookPath = path.join(hooksDirectory, 'pre-push');

    fs.mkdirSync(hooksDirectory, { recursive: true });

    const result = runMamoriCli(temporaryDirectory, ['hooks', 'install']);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: hooks install completed/u);
    assert.match(result.stdout, /pre-commit/u);
    assert.match(result.stdout, /pre-push/u);
    assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /mamori-inspector-managed-hook/u);
    assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /--mode precommit --scope staged --execute/u);
    assert.match(fs.readFileSync(prePushHookPath, 'utf8'), /--mode prepush --scope workspace --execute/u);
  });

  /**
   * Mamori 管理下の Git hooks をアンインストールできること。
   * @returns 返り値はない。
   */
  test('Uninstalls only Mamori managed hooks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const hooksDirectory = path.join(temporaryDirectory, '.git', 'hooks');
    const preCommitHookPath = path.join(hooksDirectory, 'pre-commit');
    const prePushHookPath = path.join(hooksDirectory, 'pre-push');
    const postCommitHookPath = path.join(hooksDirectory, 'post-commit');

    fs.mkdirSync(hooksDirectory, { recursive: true });

    runMamoriCli(temporaryDirectory, ['hooks', 'install']);
    fs.writeFileSync(postCommitHookPath, '#!/bin/sh\necho custom\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, ['hooks', 'uninstall']);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: hooks uninstall completed/u);
    assert.ok(!fs.existsSync(preCommitHookPath));
    assert.ok(!fs.existsSync(prePushHookPath));
    assert.ok(fs.existsSync(postCommitHookPath));
  });

  /**
   * Maven の build-definition を抽出できること。
   * @returns 返り値はない。
   */
  test('Extracts Maven build definitions from pom.xml', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // pom.xml の絶対パスを表す
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');

    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <artifactId>maven-checkstyle-plugin</artifactId>',
        '        <configuration>',
        '          <configLocation>config/checkstyle/checkstyle.xml</configLocation>',
        '        </configuration>',
        '      </plugin>',
        '      <plugin>',
        '        <artifactId>maven-pmd-plugin</artifactId>',
        '        <configuration>',
        '          <rulesets>',
        '            <ruleset>config/pmd/ruleset.xml</ruleset>',
        '          </rulesets>',
        '        </configuration>',
        '      </plugin>',
        '      <plugin>',
        '        <artifactId>spotless-maven-plugin</artifactId>',
        '      </plugin>',
        '      <plugin>',
        '        <artifactId>spotbugs-maven-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'manual',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: build-definition-summary/u);
    assert.match(result.stdout, /maven:/u);
    assert.match(result.stdout, /checkstyleConfig=config\/checkstyle\/checkstyle\.xml/u);
    assert.match(result.stdout, /pmdRulesets=config\/pmd\/ruleset\.xml/u);
    assert.match(result.stdout, /spotless=configured/u);
    assert.match(result.stdout, /spotbugs=configured/u);
  });

  /**
   * Spotless がある Maven モジュールでは formatter として計画されること。
   * @returns 返り値はない。
   */
  test('Includes spotless as an enabled formatter when Maven defines it', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // ソースディレクトリを表す
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    // 対象ファイルパスを表す
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    // pom.xml の絶対パスを表す
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <artifactId>spotless-maven-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-plan/u);
    assert.match(result.stdout, /formatters=spotless:enabled/u);
    assert.match(result.stdout, /mamori: command-plan/u);
    assert.match(result.stdout, /spotless:mvn -q spotless:apply/u);
  });

  /**
   * file scope では Semgrep の対象ファイルをコマンドへ含めること。
   * @returns 返り値はない。
   */
  test('Builds a file-scoped Semgrep command with the target file', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // ソースディレクトリを表す
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    // 対象ファイルパスを表す
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    // pom.xml の絶対パスを表す
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <artifactId>maven-checkstyle-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /semgrep:semgrep scan --sarif --config p\/java/u);
    assert.match(result.stdout, /App\.java/u);
  });

  /**
   * execute オプションで command plan を実行できること。
   * @returns 返り値はない。
   */
  test('Executes the command plan with test command wrappers', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-test.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenIssueWrapper(binDirectory, 'mvn.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'save',
        '--scope',
        'file',
        '--files',
        path.relative(temporaryDirectory, targetFilePath),
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-result/u);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.match(result.stdout, /spotless:ok exitCode=0/u);
    assert.match(result.stdout, /semgrep:ok exitCode=0/u);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /Missing Javadoc/u);
    assert.match(result.stdout, /Unused local variable/u);
    assert.match(result.stdout, /Potential issue/u);
    assert.match(result.stdout, /sarif=/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn.log'), 'utf8'), /spotless:apply/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'semgrep.log'), 'utf8'), /App\.java/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"version": "2\.1\.0"/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Missing Javadoc/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Unused local variable/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Potential issue/u);
  });

  /**
   * pre-commit で Web formatter 成功後に既存ロジックで再ステージされること。
   * @returns 返り値はない。
   */
  test('Restages web files after successful precommit formatting', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const javascriptFilePath = path.join(sourceDirectory, 'main.js');
    const gitBinDirectory = createCommandBinDirectory(temporaryDirectory);
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const gitLogPath = path.join(gitBinDirectory, 'git.log');
    const prettierLogPath = path.join(nodeBinDirectory, 'prettier.log');
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const indexSnapshotPath = path.join(temporaryDirectory, '.tmp-index', 'main.js');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(javascriptFilePath, 'const sample = 1;\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    writeGitPrecommitWrapper(
      gitBinDirectory,
      'git.log',
      path.relative(temporaryDirectory, javascriptFilePath),
      javascriptFilePath,
      indexSnapshotPath,
    );
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log', { formattedFilePath: javascriptFilePath });
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
        '--execute',
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(gitBinDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /prettier:ok/u);
    assert.match(result.stdout, /eslint:ok/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /diff --cached --name-only --diff-filter=ACMR/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /add --/u);
    assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /main\.js/u);
    assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /main\.js/u);
    assert.match(fs.readFileSync(indexSnapshotPath, 'utf8'), /formatted by prettier/u);
  });

  /**
   * pre-commit の Web checker 失敗時にも整形結果を再ステージしつつ gate できること。
   * @returns 返り値はない。
   */
  test('Fails precommit when web checkers report findings after formatting', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const javascriptFilePath = path.join(sourceDirectory, 'main.js');
    const gitBinDirectory = createCommandBinDirectory(temporaryDirectory);
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const gitLogPath = path.join(gitBinDirectory, 'git.log');
    const indexSnapshotPath = path.join(temporaryDirectory, '.tmp-index', 'main.js');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-web-precommit.sarif');
    const eslintOutput = JSON.stringify([
      {
        filePath: javascriptFilePath,
        messages: [
          {
            ruleId: 'semi',
            severity: 2,
            message: 'Missing semicolon.',
            line: 1,
            column: 17,
          },
        ],
      },
    ]);

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(javascriptFilePath, 'const sample = 1\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    writeGitPrecommitWrapper(
      gitBinDirectory,
      'git.log',
      path.relative(temporaryDirectory, javascriptFilePath),
      javascriptFilePath,
      indexSnapshotPath,
    );
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log', { formattedFilePath: javascriptFilePath });
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log', { stdout: eslintOutput, exitCode: 1 });

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(gitBinDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /prettier:ok/u);
    assert.match(result.stdout, /eslint:failed exitCode=1/u);
    assert.match(result.stdout, /Missing semicolon\./u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /add --/u);
    assert.match(fs.readFileSync(indexSnapshotPath, 'utf8'), /formatted by prettier/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Missing semicolon\./u);
  });

  /**
   * 実行コマンドが存在しない場合は実行エラーとして扱うこと。
   * @returns 返り値はない。
   */
  test('Returns exit code 2 when an execution command cannot start', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenIssueWrapper(binDirectory, 'mvn.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'save',
        '--scope',
        'file',
        '--files',
        path.relative(temporaryDirectory, targetFilePath),
        '--execute',
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 2);
    assert.match(result.stdout, /semgrep:error/u);
    assert.match(result.stdout, /failed to start/u);
  });

  /**
   * pre-commit 実行で軽量チェックのみを実行し、Issue を SARIF 化できること。
   * @returns 返り値はない。
   */
  test('Executes precommit Maven staged-scope plan and re-stages formatted files from git index', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const unstagedFilePath = path.join(sourceDirectory, 'Other.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-precommit.sarif');
    const gitIndexSnapshotPath = path.join(temporaryDirectory, 'git-index-App.java');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(unstagedFilePath, 'class Other {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenPrecommitGitWrapper(binDirectory, 'mvn-precommit.log', targetFilePath);
    writeGitPrecommitWrapper(
      binDirectory,
      'git-precommit.log',
      path.relative(temporaryDirectory, targetFilePath),
      targetFilePath,
      gitIndexSnapshotPath,
    );
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-precommit.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-result/u);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.match(result.stdout, /spotless:ok exitCode=0/u);
    assert.match(result.stdout, /semgrep:ok exitCode=0/u);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /files=.*App\.java/u);
    assert.doesNotMatch(result.stdout, /files=.*Other\.java/u);
    assert.doesNotMatch(result.stdout, /cpd:ok/u);
    assert.doesNotMatch(result.stdout, /spotbugs:ok/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-precommit.log'), 'utf8'), /checkstyle:check/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-precommit.log'), 'utf8'), /pmd:check/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-precommit.log'), 'utf8'), /spotless:apply/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'semgrep-precommit.log'), 'utf8'), /scan --sarif/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'semgrep-precommit.log'), 'utf8'), /App\.java/u);
    assert.doesNotMatch(fs.readFileSync(path.join(binDirectory, 'semgrep-precommit.log'), 'utf8'), /Other\.java/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'git-precommit.log'), 'utf8'), /diff --cached --name-only --diff-filter=ACMR/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'git-precommit.log'), 'utf8'), /add --/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'git-precommit.log'), 'utf8'), /App\.java/u);
    assert.doesNotMatch(fs.readFileSync(path.join(binDirectory, 'git-precommit.log'), 'utf8'), /Other\.java/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Missing Javadoc/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Unused local variable/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Potential issue/u);
    assert.match(fs.readFileSync(targetFilePath, 'utf8'), /formatted by spotless/u);
    assert.match(fs.readFileSync(gitIndexSnapshotPath, 'utf8'), /formatted by spotless/u);
  });

  /**
   * pre-push で class ルートが無い場合は SpotBugs を警告付きでスキップ計画にすること。
   * @returns 返り値はない。
   */
  test('Marks spotbugs as skipped when prepush workspace has no class roots', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // pom.xml の絶対パスを表す
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');

    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <artifactId>maven-checkstyle-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-plan/u);
    assert.match(result.stdout, /spotbugs:disabled status=skipped/u);
    assert.match(
      result.stdout,
      /spotbugs was skipped because no compiled classes were found in target\/classes or build\/classes\/java\/main/u,
    );
  });

  /**
   * Gradle の build-definition を抽出できること。
   * @returns 返り値はない。
   */
  test('Extracts Gradle build definitions from build.gradle', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // Gradle ビルドファイルの絶対パスを表す
    const buildFilePath = path.join(temporaryDirectory, 'build.gradle');

    fs.writeFileSync(
      buildFilePath,
      [
        'plugins {',
        '  id "checkstyle"',
        '  id "pmd"',
        '  id "com.diffplug.spotless" version "6.0.0"',
        '}',
        '',
        'checkstyle {',
        '  configFile = file("config/checkstyle/checkstyle.xml")',
        '}',
        '',
        'pmd {',
        '  ruleSetFiles = files("config/pmd/ruleset.xml")',
        '}',
        '',
        'spotbugs {',
        '  excludeFilter = file("config/spotbugs/exclude.xml")',
        '}',
        '',
        'spotless {',
        '  java {}',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'manual',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: build-definition-summary/u);
    assert.match(result.stdout, /gradle:/u);
    assert.match(result.stdout, /checkstyleConfig=config\/checkstyle\/checkstyle\.xml/u);
    assert.match(result.stdout, /pmdRulesets=config\/pmd\/ruleset\.xml/u);
    assert.match(result.stdout, /spotless=configured/u);
    assert.match(result.stdout, /spotbugs=configured/u);
    assert.match(result.stdout, /spotbugsExcludeFilter=config\/spotbugs\/exclude\.xml/u);
  });

  /**
   * Gradle 実行でも Checkstyle / PMD / Semgrep を Issue 化できること。
   * @returns 返り値はない。
   */
  test('Executes Gradle command plan and collects issues through shared adapters', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const buildFilePath = path.join(temporaryDirectory, 'build.gradle');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-gradle.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      buildFilePath,
      [
        'plugins {',
        '  id "checkstyle"',
        '  id "pmd"',
        '  id "com.diffplug.spotless" version "6.0.0"',
        '}',
        '',
        'checkstyle {',
        '  configFile = file("config/checkstyle/checkstyle.xml")',
        '}',
        '',
        'pmd {',
        '  ruleSetFiles = files("config/pmd/ruleset.xml")',
        '}',
        '',
        'spotless {',
        '  java {}',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    writeGradleIssueWrapper(binDirectory, 'gradle.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-gradle.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'save',
        '--scope',
        'file',
        '--files',
        path.relative(temporaryDirectory, targetFilePath),
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.match(result.stdout, /spotless:ok exitCode=0/u);
    assert.match(result.stdout, /semgrep:ok exitCode=0/u);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /Gradle Checkstyle finding/u);
    assert.match(result.stdout, /Gradle PMD finding/u);
    assert.match(result.stdout, /Potential issue/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'gradle.log'), 'utf8'), /spotlessApply/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Gradle Checkstyle finding/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Gradle PMD finding/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Potential issue/u);
  });

  /**
   * pre-push 実行で CPD と SpotBugs を Issue 化できること。
   * @returns 返り値はない。
   */
  test('Executes prepush Maven plan and collects CPD and SpotBugs issues', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const classDirectory = path.join(temporaryDirectory, 'target', 'classes');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-prepush.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.mkdirSync(classDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, 'App.java'), 'class App {}\n', 'utf8');
    fs.writeFileSync(path.join(sourceDirectory, 'Other.java'), 'class Other {}\n', 'utf8');
    fs.writeFileSync(path.join(classDirectory, 'App.class'), 'compiled', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotbugs-maven-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenPrepushWrapper(binDirectory, 'mvn-prepush.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-prepush.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'prepush',
        '--scope',
        'workspace',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /cpd:ok exitCode=0/u);
    assert.match(result.stdout, /spotbugs:ok exitCode=0/u);
    assert.match(result.stdout, /Duplicated block detected/u);
    assert.match(result.stdout, /Possible null pointer dereference/u);
    assert.match(result.stdout, /issues=4/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-prepush.log'), 'utf8'), /spotbugs:check/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Duplicated block detected/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Possible null pointer dereference/u);
  });

  /**
   * Gradle の pre-push 実行でも CPD と SpotBugs を Issue 化できること。
   * @returns 返り値はない。
   */
  test('Executes Gradle prepush plan and collects CPD and SpotBugs issues', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const classDirectory = path.join(temporaryDirectory, 'build', 'classes', 'java', 'main');
    const buildFilePath = path.join(temporaryDirectory, 'build.gradle');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-gradle-prepush.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.mkdirSync(classDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, 'App.java'), 'class App {}\n', 'utf8');
    fs.writeFileSync(path.join(sourceDirectory, 'Other.java'), 'class Other {}\n', 'utf8');
    fs.writeFileSync(path.join(classDirectory, 'App.class'), 'compiled', 'utf8');
    fs.writeFileSync(
      buildFilePath,
      [
        'plugins {',
        '  id "checkstyle"',
        '  id "pmd"',
        '  id "com.diffplug.spotless" version "6.0.0"',
        '  id "com.github.spotbugs" version "6.0.18"',
        '}',
        '',
        'checkstyle {',
        '  configFile = file("config/checkstyle/checkstyle.xml")',
        '}',
        '',
        'pmd {',
        '  ruleSetFiles = files("config/pmd/ruleset.xml")',
        '}',
        '',
        'spotless {',
        '  java {}',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    writeGradlePrepushWrapper(binDirectory, 'gradle-prepush.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-gradle-prepush.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'prepush',
        '--scope',
        'workspace',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /cpd:ok exitCode=0/u);
    assert.match(result.stdout, /spotbugs:ok exitCode=0/u);
    assert.match(result.stdout, /Duplicated block detected/u);
    assert.match(result.stdout, /Dead store to local variable/u);
    assert.match(result.stdout, /Potential issue/u);
    assert.match(result.stdout, /issues=4/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'gradle-prepush.log'), 'utf8'), /cpdCheck/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'gradle-prepush.log'), 'utf8'), /spotbugsMain/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Duplicated block detected/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Dead store to local variable/u);
  });
});