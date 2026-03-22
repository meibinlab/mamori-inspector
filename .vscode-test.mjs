// VS Code テストランナー設定APIを表す
import { defineConfig } from '@vscode/test-cli';

// CI 実行かどうかを表す
const isCi = process.env.CI === 'true';
// ローカル隔離実行かどうかを表す
const isIsolatedRun = process.env.MAMORI_VSCODE_TEST_ISOLATED === 'true';

// テスト対象の設定を表す
const testConfig = defineConfig({
  files: 'out/test/extension.test.js',
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
