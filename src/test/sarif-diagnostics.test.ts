// 断言ユーティリティを表す
import * as assert from 'assert';
// SARIF Diagnostics 変換器を表す
import { parseSarifFindings } from '../sarif-diagnostics';

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
});