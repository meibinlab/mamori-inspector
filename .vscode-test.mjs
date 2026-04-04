import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// CI 実行かどうかを表す
const isCi = process.env.CI === 'true';
// ローカル隔離実行かどうかを表す
const isIsolatedRun = process.env.MAMORI_VSCODE_TEST_ISOLATED === 'true';
// 外部実プロジェクト検証用の extension host 環境値を表す
const extensionHostEnvironment = process.env.MAMORI_REAL_PROJECT_ROOT
  ? {
      MAMORI_REAL_PROJECT_ROOT: process.env.MAMORI_REAL_PROJECT_ROOT,
    }
  : undefined;
// 隔離実行ごとの一意な識別子を表す
const isolatedRunId = `${Date.now()}-${process.pid}`;
// 隔離実行向けの作業ディレクトリを表す
const isolatedRunDirectory = path.join(os.tmpdir(), 'mamori-vscode-test', isolatedRunId);
// 隔離実行向けの追加起動引数を表す
const isolatedLaunchArguments = isIsolatedRun
  ? [
      '--user-data-dir',
      path.join(isolatedRunDirectory, 'user-data'),
      '--extensions-dir',
      path.join(isolatedRunDirectory, 'extensions'),
      '--disable-workspace-trust',
      ...(extensionHostEnvironment
        ? [
            '--extensionEnvironment',
            JSON.stringify(extensionHostEnvironment),
          ]
        : []),
    ]
  : [];
// 隔離実行向けの環境変数を表す
const isolatedEnvironment = isIsolatedRun
  ? {
      ...process.env,
      MAMORI_CLI_NODE_PATH: process.execPath,
      ...(process.env.MAMORI_REAL_PROJECT_ROOT
        ? {
            MAMORI_REAL_PROJECT_ROOT: process.env.MAMORI_REAL_PROJECT_ROOT,
          }
        : {}),
    }
  : undefined;

// テスト対象の設定を表す
const testConfig = defineConfig({
  files: 'out/test/extension.test.js',
  workspaceFolder: '.',
  launchArgs: isolatedLaunchArguments,
  mocha: {
    ui: 'tdd',
  },
  env: isolatedEnvironment,
  ...(isCi || isIsolatedRun
    ? {}
    : {
        useInstallation: {
          fromMachine: true,
        },
      }),
});

// テスト設定を公開する
export default testConfig;
