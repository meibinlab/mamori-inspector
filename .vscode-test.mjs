// VS Code テストランナー設定APIを表す
import { defineConfig } from '@vscode/test-cli';

// テスト対象の設定を表す
const testConfig = defineConfig({
  files: 'out/test/**/*.test.js',
});

// テスト設定を公開する
export default testConfig;
