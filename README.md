# Mamori Inspector
Mamori Inspector is a unified code inspection platform for VS Code that orchestrates multiple analysis tools and presents results in a single, developer-friendly interface.

- Japanese: [README.ja.md](README.ja.md)

## Installation
1. Install the Mamori Inspector extension in VS Code.
2. Open the target repository as a VS Code workspace.
3. Save a supported file to trigger automatic save-time validation.
4. If you also want validation on commit and push, run the command `Mamori Inspector: Install Git Hooks` once.

## Initial Setup Notes
- Save-time validation starts automatically after the extension is installed and a supported file is saved.
- Git hook validation does not start automatically on extension installation. You must install the managed hooks explicitly.
- `precommit/staged` requires the Git CLI on `PATH` because staged files are resolved with `git diff --cached --name-only --diff-filter=ACMR`.
- For web checkers, Mamori resolves configuration in this order: explicit setting, discovered config file, `package.json` setting, bundled minimal config.
- JavaScript files and HTML inline script checks fall back to the bundled minimal ESLint config when project configuration is not detected. The bundled fallback is intentionally conservative and uses compatibility-oriented core rules.
- CSS and SCSS and Sass checks, and HTML inline style checks, fall back to the bundled minimal Stylelint config when project configuration is not detected.
- HTML checks fall back to the bundled minimal htmlhint config when project configuration is not detected.

## Current Behavior
- Java, JavaScript, JavaScript React, CSS, SCSS, Sass, and HTML files trigger an automatic background check on save with debounce and recursion suppression.
- Save-time validation formats supported files first, then publishes diagnostics from the generated SARIF.
- JavaScript save-time validation uses Prettier and ESLint, preferring explicit or discovered project configuration and otherwise using Mamori's bundled minimal ESLint config.
- CSS and SCSS and Sass save-time validation use Prettier and Stylelint, preferring explicit or discovered project configuration and otherwise using Mamori's bundled minimal Stylelint config.
- HTML save-time validation also extracts inline style blocks whose type is compatible with CSS into temporary CSS files for Stylelint, maps diagnostics back to the original HTML locations, and removes the temporary files after execution while preferring project Stylelint configuration and otherwise using Mamori's bundled minimal Stylelint config.
- HTML save-time validation uses Prettier and htmlhint, preferring explicit or discovered project configuration and otherwise using Mamori's bundled minimal htmlhint config.
- HTML save-time validation also extracts inline script blocks without `src` into temporary JavaScript files for ESLint, maps diagnostics back to the original HTML locations, and removes the temporary files after execution while preferring project ESLint configuration and otherwise using Mamori's bundled minimal ESLint config.
- `precommit/staged` resolves staged files via `git diff --cached --name-only --diff-filter=ACMR`, runs Spotless first when available, and re-stages formatted files with `git add -- <files>`.
- `precommit/staged` also runs Prettier for staged JavaScript, CSS, SCSS, Sass, and HTML files before running the configured checkers.
- `precommit/staged` includes HTML inline style blocks in the Stylelint target set while keeping HTML files themselves on htmlhint.
- `precommit/staged` includes HTML inline script blocks in the ESLint target set while keeping HTML files themselves on htmlhint.
- `precommit/staged` returns success without running checks when no staged files are detected, and requires the Git CLI on `PATH` for staged-file resolution.
- `prepush/workspace` runs lightweight Java checks plus CPD, and adds SpotBugs only when compiled class roots such as `target/classes` or `build/classes/java/main` exist.
- `prepush/workspace` also runs ESLint, Stylelint, and htmlhint for workspace files, preferring explicit or discovered project configuration and otherwise using Mamori's bundled minimal configs.
- `prepush/workspace` includes HTML inline style blocks in Stylelint by using temporary CSS files and reporting findings on the original HTML locations.
- `prepush/workspace` includes HTML inline script blocks in ESLint by using temporary JavaScript files and reporting findings on the original HTML locations.
- `manual/workspace` currently reuses the lightweight Java check plan until the heavy manual tools are added.
- The command `Mamori Inspector: Run Workspace Check` executes a workspace-wide manual check and publishes diagnostics from the generated SARIF.
- The commands `Mamori Inspector: Install Git Hooks` and `Mamori Inspector: Uninstall Git Hooks` call the same runner as the CLI and manage `.git/hooks/pre-commit` and `.git/hooks/pre-push`.
- Maven and Gradle build definitions are inspected to resolve Java tooling such as Checkstyle, PMD, Spotless, CPD, and SpotBugs.
- `mamori.js hooks install` and `mamori.js hooks uninstall` create or remove managed `pre-commit` and `pre-push` hooks under `.git/hooks`.

## HTML Inline JS And CSS Checks
- Mamori splits HTML validation across htmlhint for markup, ESLint for inline script blocks, and Stylelint for inline style blocks.
- Inline script checks target only `script` tags without `src` whose `type` is omitted, empty, `module`, or a JavaScript MIME type such as `text/javascript`, `application/javascript`, or `application/ecmascript`.
- Parameterized JavaScript MIME types such as `text/javascript; charset=utf-8` are normalized and treated as JavaScript.
- Inline script blocks with non-JavaScript `type` values such as `text/plain` are excluded from ESLint.
- Inline style checks target only `style` tags whose `type` is omitted, empty, `text/css`, or a parameterized `text/css` value such as `text/css; charset=utf-8`.
- Inline style blocks with non-CSS `type` values are excluded from Stylelint.
- Findings from inline script and inline style checks are mapped back to the original HTML locations, and the temporary extracted files are removed after each execution.

## Validation Modes
| Trigger | Starts automatically after extension install | Additional setup | Scope | Notes |
| ---- | ---- | ---- | ---- | ---- |
| Save | Yes | None | Saved file only | Runs when a supported file is saved in the workspace. |
| Pre-commit | No | Run `Mamori Inspector: Install Git Hooks` | Staged files only | Blocks commit on validation failure. |
| Pre-push | No | Run `Mamori Inspector: Install Git Hooks` | Workspace | Blocks push on validation failure, except SpotBugs skip conditions defined in the spec. |
| Manual | No | None | Workspace | Run with `Mamori Inspector: Run Workspace Check`. |

## Save Validation Versus Git Hook Validation
- Save validation starts automatically after extension installation and runs only for the file being saved.
- Save validation is intended for fast editor feedback and updates VS Code Problems from the generated SARIF.
- Git hook validation does not run until the managed hooks are installed.
- Pre-commit validation runs on staged files only and re-stages formatter changes automatically.
- Pre-push validation runs on the workspace scope and acts as a broader gate before pushing changes.

## Files Required For Each Check
| Check | Files you should prepare | Notes |
| ---- | ---- | ---- |
| Java Checkstyle | `pom.xml`, `build.gradle`, or `build.gradle.kts` with Checkstyle configuration | Java checks are resolved from Maven or Gradle build definitions. |
| Java PMD | `pom.xml`, `build.gradle`, or `build.gradle.kts` with PMD configuration | Java checks are resolved from Maven or Gradle build definitions. |
| Java Spotless | `pom.xml`, `build.gradle`, or `build.gradle.kts` with Spotless configuration | Used for Java formatting during save and pre-commit when configured. |
| Java SpotBugs | `pom.xml`, `build.gradle`, or `build.gradle.kts` with SpotBugs configuration | `prepush/workspace` also needs compiled classes under `target/classes` or `build/classes/java/main`. |
| Java Semgrep | No required config file, or optional `.semgrep.yml` | If `.semgrep.yml` is not present, Mamori uses the default `p/java` ruleset. |
| JavaScript ESLint | Optional: one of `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs`, `eslint.config.ts`, `eslint.config.mts`, `eslint.config.cts`, `.eslintrc`, `.eslintrc.js`, `.eslintrc.cjs`, `.eslintrc.json`, `.eslintrc.yaml`, `.eslintrc.yml`, `.eslintrc.ts`, `.eslintrc.mts`, `.eslintrc.cts`, or `package.json` with `eslintConfig` | Mamori prefers project configuration when present and otherwise uses a bundled minimal ESLint config for JavaScript files and HTML inline script checks. |
| CSS / SCSS / Sass Stylelint | Optional: one of `stylelint.config.js`, `stylelint.config.mjs`, `stylelint.config.cjs`, `stylelint.config.ts`, `stylelint.config.mts`, `stylelint.config.cts`, `.stylelintrc`, `.stylelintrc.js`, `.stylelintrc.cjs`, `.stylelintrc.json`, `.stylelintrc.yaml`, `.stylelintrc.yml`, `.stylelintrc.ts`, `.stylelintrc.mts`, `.stylelintrc.cts`, or `package.json` with `stylelint` | Mamori prefers project configuration when present and otherwise uses a bundled minimal Stylelint config for CSS files and HTML inline style checks. |
| HTML htmlhint | Optional: one of `.htmlhintrc`, `.htmlhintrc.js`, `.htmlhintrc.cjs`, `.htmlhintrc.json`, `.htmlhintrc.yaml`, `.htmlhintrc.yml`, or `package.json` with `htmlhint` | Mamori prefers project configuration when present and otherwise uses a bundled minimal htmlhint config for HTML checks. |
| Prettier for JavaScript / CSS / HTML | No Mamori-specific config file is required | If your project uses a Prettier config, keep it in the project as usual so formatting behavior matches your repository rules. |

## Spec
- docs/spec.md

## Runner Structure
- docs/runner-structure.md

