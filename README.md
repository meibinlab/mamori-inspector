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
- JavaScript checks run only when ESLint configuration is detected.
- CSS and SCSS and Sass checks run only when Stylelint configuration is detected.
- HTML checks run only when htmlhint configuration is detected.

## Current Behavior
- Java, JavaScript, JavaScript React, CSS, SCSS, Sass, and HTML files trigger an automatic background check on save with debounce and recursion suppression.
- Save-time validation formats supported files first, then publishes diagnostics from the generated SARIF.
- JavaScript save-time validation uses Prettier and ESLint when ESLint configuration is detected.
- CSS and SCSS and Sass save-time validation use Prettier and Stylelint when Stylelint configuration is detected.
- HTML save-time validation uses Prettier and htmlhint when htmlhint configuration is detected.
- `precommit/staged` resolves staged files via `git diff --cached --name-only --diff-filter=ACMR`, runs Spotless first when available, and re-stages formatted files with `git add -- <files>`.
- `precommit/staged` also runs Prettier for staged JavaScript, CSS, SCSS, Sass, and HTML files before running the configured checkers.
- `precommit/staged` returns success without running checks when no staged files are detected, and requires the Git CLI on `PATH` for staged-file resolution.
- `prepush/workspace` runs lightweight Java checks plus CPD, and adds SpotBugs only when compiled class roots such as `target/classes` or `build/classes/java/main` exist.
- `prepush/workspace` also runs ESLint, Stylelint, and htmlhint for workspace files when the corresponding configuration is detected.
- `manual/workspace` currently reuses the lightweight Java check plan until the heavy manual tools are added.
- The command `Mamori Inspector: Run Workspace Check` executes a workspace-wide manual check and publishes diagnostics from the generated SARIF.
- The commands `Mamori Inspector: Install Git Hooks` and `Mamori Inspector: Uninstall Git Hooks` call the same runner as the CLI and manage `.git/hooks/pre-commit` and `.git/hooks/pre-push`.
- Maven and Gradle build definitions are inspected to resolve Java tooling such as Checkstyle, PMD, Spotless, CPD, and SpotBugs.
- `mamori.js hooks install` and `mamori.js hooks uninstall` create or remove managed `pre-commit` and `pre-push` hooks under `.git/hooks`.

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
| JavaScript ESLint | One of `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs`, `eslint.config.ts`, `eslint.config.mts`, `eslint.config.cts`, `.eslintrc`, `.eslintrc.js`, `.eslintrc.cjs`, `.eslintrc.json`, `.eslintrc.yaml`, `.eslintrc.yml`, `.eslintrc.ts`, `.eslintrc.mts`, `.eslintrc.cts`, or `package.json` with `eslintConfig` | Without one of these files or settings, JavaScript checks are skipped. |
| CSS / SCSS / Sass Stylelint | One of `stylelint.config.js`, `stylelint.config.mjs`, `stylelint.config.cjs`, `stylelint.config.ts`, `stylelint.config.mts`, `stylelint.config.cts`, `.stylelintrc`, `.stylelintrc.js`, `.stylelintrc.cjs`, `.stylelintrc.json`, `.stylelintrc.yaml`, `.stylelintrc.yml`, `.stylelintrc.ts`, `.stylelintrc.mts`, `.stylelintrc.cts`, or `package.json` with `stylelint` | Without one of these files or settings, CSS checks are skipped. |
| HTML htmlhint | One of `.htmlhintrc`, `.htmlhintrc.js`, `.htmlhintrc.cjs`, `.htmlhintrc.json`, `.htmlhintrc.yaml`, `.htmlhintrc.yml`, or `package.json` with `htmlhint` | Without one of these files or settings, HTML checks are skipped. |
| Prettier for JavaScript / CSS / HTML | No Mamori-specific config file is required | If your project uses a Prettier config, keep it in the project as usual so formatting behavior matches your repository rules. |

## Spec
- docs/spec.md

## Runner Structure
- docs/runner-structure.md

