# Changelog

All notable changes to the Minr Scripts VS Code extension from newest to oldest.

## 4.0.0

- Added 40+ errors which are now highlighted correctly and with informative error messages.
- Created a lint rule registry with stable codes grouped into categories.
- Wrote documentation for each rule, which is surfaced by the error handler.
- Severity of lint errors is now configurable per category via new `msc.lint.<category>` settings.
- Added `# msc-ignore` syntax, which suppresses diagnostics for a specific error, all errors on the next line, or the entire file.
- Added F2 rename support for local variables in `.msc` files, namespace functions, variables, classes, methods and fields.
- Rewrote the whole parser to track actual types the entire way through scripts.
- Implicit active namespace is now inferred from the file's path so a `.msc` inside a namespace folder behaves correctly.
- Script parameters are now read from the `.nms` declaration rather than the first-line comment.
- Operator expressions are resolved through a table, feeding into argument checking.
- Various performance improvements, including debouncing validation, pruning file search, unifying the resolver, and pruning namespaces.

## 3.2.1

- Added a diagnostic to reflect `@bypass /script` no longer being allowed on the server.

## 3.2.0

- Updated the block, item, entity, and effect lists to match Minecraft 1.21.11.
- All vanilla Minecraft commands are now offered as autocomplete suggestions with hints for common arguments.
- Improved autofill for the `@using` operator.
- Constructor signatures in `.nms` files are now properly escaped when registered, fixing crashes on some classes.
- Cached records so that namespaces are not re-parsed on every keystroke.
- The default namespace file is no longer fetched from GitHub on startup to improve load times.
- Refreshing one `.nms` file no longer wipes data for other source files.

## 3.1.0

- Uploading scripts and namespaces now generates a ready-to-paste `/script import ...` command instead of a raw URL.
- Uploaded `.msc` files are now cached, so re-exporting a partially changed namespace is much faster.
- Smart export builds the full import command for the entire namespace, including child functions, methods, and constructors.
- Autocomplete for the `this` keyword inside class methods and constructors, resolving to the enclosing class's fields and methods.
- Go-to-definition (F12) now jumps to types, functions, constructors, variables, and custom scripts.
- All extension commands and notifications now use a consistent style and format.
- Updated the default namespace to bring it in line with server updates.

## 3.0.2

- Removed the return type from generated function signatures.
- The import script now auto-removes itself after being run.

## 3.0.1

- Added block and item JSON data added to drive command-argument completion within Minecraft commands.
- Improved the parser and autofill for Minecraft commands.
- Improved accuracy of error checking.
- Fixed a bug where errors would become duplicated on every keystroke. 
- Permission / chat / general command-executor commands are now flagged as banned.
- Fixed a regex issue which was incorrectly flagging valid script lines as errors.

## 3.0.0

- Added some basic static error highlighting for missing `@fi` / `@done` for `@if` / `@for`, malformed lines, banned commands, and nested-block validation.
- Enabled in-IDE "quick fixes" for several of the new diagnostics.
- Enabled a formatter which automatically handles indentation correctly.
- Added autocomplete for some Minecraft commands: `@bypass`, `@console`, `give`, and other commands now suggest argument structure.
- Updated autofill descriptions across the keyword set.
- Fixed several broken edge cases with the parser.

## 2.2.0

- Added `<#path/to/file.msc>` syntax within MSC scripts, which are automatically expanded out into `paste.minr.org` URLs at import time.
- Missing and empty files during namespace are now errors, which means the upload will now fail if any file is missing.

## 2.1.19

- Added a "Update namespace" command that re-uploads child scripts and re-runs the init script without redefining the namespace itself, so existing variable state is preserved.
- Cleaned up some documentation in the default namespace.

## 2.1.18

- Fixed autocompletion for namespaces declared in subfolders rather than the workspace root.

## 2.1.17

- Namespaces no longer have to live at the workspace root; the extension now walks the workspace looking for `.nms` files and resolves each `.msc` against its enclosing namespace folder.

## 2.1.16

- Syntax highlighting now works inside `{{...}}` expression interpolations within string literals.
- `final` and `relative` are now properly recognised as keywords in `.nms` files.
- Updated the default namespace.

## 2.1.15

- Fixed a string escape-sequence bug in both grammars.

## 2.1.14

- Maintenance release.

## 2.1.13

- Added the built-in namespaces `scoreboard` and `timer` to the default anmespace.
- Fixed a bug where stale namespace suggestions were never removed when a `.nms` file changed.
- Fixed a bug where keyword suggestions were dropped in some contexts.
- Fixed two more regex issues in the parser.

## 2.1.12

- Fixed a regex issue in the `.nms` parser.

## 2.1.11

- Array variables in `.nms` files can now be split into multiple lines to make maintaining them easier.
- Scripts in `__init__.msc` within a namespace folder will now be automatically run once when a namespace is uploaded.
- Added highlighting for string and numeric literals in `.nms` files.
- Trying to upload an empty file now throws an error, as does uploading a namespace with empty function files.

## 2.1.10

- Expanded `.nms` syntax highlighting to cover string literals, numeric literals, operators, and punctuation.
- Updated the namespace upload flow to match.

## 2.1.9

- Added namespace upload progress bar.
- Fixed the syntax for filenames corresponding to constructors.
- Variable definitions are emitted last in generated namespace import scripts so functions / types are defined before any `/variable set` lines run.
- Added a delay before variables with function calls are evaluated on import to allow time for function scripts to import.

## 2.1.8

- Fixed completion suggestions failing inside call chains that involve arrays.
- Added support for `::` (double colon) in constructors during namespace import.
- Local variables declared inside `@if` and `@for` blocks are now scoped correctly.
- Updated `String` and `Player` methods in the default namespace.
- Added namespaces `list`, `util`, and `text` to the default namespace.

## 2.1.7

- The extension now checks GitHub on startup for an updated `default.nms` and refreshes the bundled copy.

## 2.1.6

- Expanded documentation for built-in types in the default namespace.
- Loop variables (the element variable in `@for`) now appear in suggestions inside the loop body.
- File icons added for `.msc` and `.nms` (red and gold "Minr Crown" SVGs).

## 2.1.5

- Fixed `#` comments only highlighting when followed by a space.

## 2.1.4

- Array types are now supported throughout the `.nms` parser and completion provider.
- Added constructor documentation for built-in classes.

## 2.1.3

- Namespace files now support the `relative` variable modifier.
- Default `player` and `block` variables are now surfaced in completion (so scripts know about the implicit variables).

## 2.1.2

- First-line parameter comment syntax updated in the parser.

## 2.1.1

- Improved namespace upload reliability.

## 2.1.0

- Added the "Upload namespace" command, which uploads every script under a namespace folder and assembles a single import script for the parent namespace.

## 2.0.0

- Rewrote the extension in full as a language-server extension containing an LSP client and server.
- Code completion, signature help, and hover help are now backed by a new language server.
- Added the `.nms` (namespace declaration) file type with its own grammar (`syntaxes/nms.tmLanguage.json`) and language configuration.
- Bundled a default namespace configuration declaring the built-in server MSC types and namespaces.

## 1.1.0

- Added autocompletion snippets for each operator to expand out as you type.
- Configured olding markers so `@if` ... `@fi` and `@for` ... `@done` blocks fold correctly in the editor.

## 1.0.2

- Enabled highlighting for line comments (`# ...`).
- The `{{ ... }}` interpolation is now highlighted correctly inside string literals.
- Added `Region` and `Item` added to the recognised type keywords.

## 1.0.0

- Added extension icon.
- Released to the Visual Studio Code Marketplace.

## 0.0.1

- Grammar for `.msc` covering keywords, built-in types, string and numeric literals, and basic punctuation.
- Created language configuration with bracket pairs and auto-closing.
- Added syntax highlighting for operators and literals.
- Added upload and download functionality for scripts.
