# Mamori Inspector
Mamori Inspector is a unified code inspection platform for VS Code that orchestrates multiple analysis tools and presents results in a single, developer-friendly interface.

## Current Behavior
- Java files trigger an automatic background check on save with debounce and recursion suppression.
- `precommit/staged` resolves staged files via `git diff --cached --name-only --diff-filter=ACMR`, runs Spotless first when available, and re-stages formatted files with `git add -- <files>`.
- `precommit/staged` returns success without running checks when no staged files are detected, and requires the Git CLI on `PATH` for staged-file resolution.
- `prepush/workspace` runs lightweight Java checks plus CPD, and adds SpotBugs only when compiled class roots such as `target/classes` or `build/classes/java/main` exist.
- `manual/workspace` currently reuses the lightweight Java check plan until the heavy manual tools are added.
- The command `Mamori Inspector: Run Workspace Check` executes a workspace-wide manual check and publishes diagnostics from the generated SARIF.
- The commands `Mamori Inspector: Install Git Hooks` and `Mamori Inspector: Uninstall Git Hooks` call the same runner as the CLI and manage `.git/hooks/pre-commit` and `.git/hooks/pre-push`.
- Maven and Gradle build definitions are inspected to resolve Java tooling such as Checkstyle, PMD, Spotless, CPD, and SpotBugs.
- `mamori.js hooks install` and `mamori.js hooks uninstall` create or remove managed `pre-commit` and `pre-push` hooks under `.git/hooks`.

## Spec
- docs/spec.md

## Runner Structure
- docs/runner-structure.md
