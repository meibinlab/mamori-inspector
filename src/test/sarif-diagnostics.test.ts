// 断言ユーティリティを表す
import * as assert from 'assert';
// ファイルシステム API を表す
import * as fs from 'fs';
// OS 一時ディレクトリ API を表す
import * as os from 'os';
// パス操作 API を表す
import * as path from 'path';
// SARIF Diagnostics 変換器を表す
import { loadSarifFindings, parseSarifFindings } from '../sarif-diagnostics';

/**
 * SARIF Diagnostics 変換のテストスイートを定義する。
 * @returns 返り値はない。
 */
suite('SARIF Diagnostics Test Suite', () => {
  /**
   * SARIF から Diagnostics を生成できること。
   * @returns 返り値はない。
   */
  test('Parses SARIF results into normalized findings', () => {
    const rawSarif = JSON.stringify({
      runs: [
        {
          results: [
            {
              ruleId: 'java.lang.security.audit',
              level: 'warning',
              message: { text: 'Potential issue' },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'src/main/java/App.java' },
                    region: { startLine: 4, startColumn: 2 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const findings = parseSarifFindings(rawSarif);

    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].message, 'Potential issue');
    assert.strictEqual(findings[0].level, 'warning');
    assert.strictEqual(findings[0].uri, 'src/main/java/App.java');
    assert.strictEqual(findings[0].startLine, 4);
    assert.strictEqual(findings[0].startColumn, 2);
    assert.strictEqual(findings[0].ruleId, 'java.lang.security.audit');
  });

  /**
   * SARIF ファイルが存在しない場合は空配列を返すこと。
   * @returns 返り値はない。
   */
  test('Returns empty findings when SARIF file does not exist', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mamori-sarif-'));

    try {
      const sarifPath = path.join(temporaryDirectory, 'missing.sarif');
      const findings = loadSarifFindings(sarifPath);

      assert.deepStrictEqual(findings, []);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});