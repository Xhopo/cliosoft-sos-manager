# ClioSoft SOS Manager VSCode Extension

## Overview

This VSCode extension integrates with ClioSoft SOS Manager, providing file status decorations in Explorer and allowing users to view and switch between different versions of files.

## What's New in v0.48.1

**Quiet for non-SOS files + unmissable Discard prompt**

- 🔕 Commands (Checkout / Checkin / Discard / Update / Create / Diff) on files that are **not under SOS version control** no longer raise an error — they are silently skipped
- 🧱 The Discard prompt for files *modified without a checkout* is now a **modal dialog**, so it can no longer be missed as a transient toast

Previous (v0.48.0) — **Shortcuts in any editor & honest Discard**

- ⌨️ Quick commands (Check Out / Check In / Discard) now also work when a file is open in a **non-text editor** (e.g. Hex Editor for binary/unsupported files): the keybinding no longer requires a focused text editor, and the active file is resolved from the active tab
- 🧹 **Discard no longer reports a false success** for files that are *modified without a checkout* (SOS `-sncm` state, e.g. `f-M---`). Such files cannot be discarded because there is no checkout lock. The extension detects them and offers **Update**, which restores the file via a consistency-check Selective Update (`soscmd updatesel -ccw`) and keeps the modified copy as `.SVM`

See [CHANGELOG.md](CHANGELOG.md) for full details.

## Features

- **File Status Decorations**: Displays file status icons and tooltips in VSCode Explorer:
  - 🔓 Checked Out
  - 🔒 Checked In
  - ✏️ Modified
  - ⚠️ Has New Revision

- **File Versions Panel**: Displays a list of versions for the currently opened file in VSCode sidebar.
  - Version ID: The version number
  - CI BY: The person who made the change
  - CI TIME: The time the change was made
  - Current version indicator: ✓ marks the currently active version
  - **Quick Version Switching**: Click on any version in the list to switch the current file to that version.

- **Context Menu Commands**: Right-click files, folders, editor tabs, editor content, or Changed Files entries to access SOS commands:
  - Check out: Check out selected files or folders without lock
  - Check in: Check in selected files with comments
  - Diff: Compare each selected file with its SOS default revision (`soscmd diff -gui <file>`). Multiple files are compared one by one, not against each other
  - Diff Two SOS Revisions: Compare one file's workarea/checkout against a selected revision, or compare two historical revisions using `file/#/rev`
  - Discard: Discard changes (with option to force discard all changes). Files modified without a checkout (`-sncm`) are steered to Update instead, since `soscmd discard` cannot revert them
  - Update: Update selected files or folders; folders use `updatesel` to avoid whole-workarea update
  - SOS create file: Create selected file paths in SOS (`soscmd create <file_path>`)
  - Office open: Open the file in Office
  - Compile RTL: Compile the RTL code
  - Rebuild ctags: Rebuild ctags for the project

- **Status Bar Toggle**: Pause/resume automatic status refresh:
  - Click the status bar button to toggle refresh on/off
  - Refresh only occurs when VSCode window is focused
  - Designed for Linux environments

## Requirements

- VSCode 1.85 or higher
- ClioSoft SOS Manager installed and configured on your system
- Linux environment (recommended for full functionality)

## Installation

1. Download the extension package (.vsix file) from the release page.
2. Open VSCode.
3. Go to the Extensions view (Ctrl+Shift+X).
4. Click on the "..." menu in the top right corner.
5. Select "Install from VSIX...".
6. Navigate to and select the downloaded .vsix file.
7. Click "Install" to install the extension.

## Usage

1. Open a file in VSCode that is managed by ClioSoft SOS.
2. File status decorations will appear in Explorer showing the current state.
3. Click on the ClioSoft SOS icon in the Activity Bar to open the sidebar panel.
4. The "File Versions" view will display a list of versions for the currently opened file.
5. Click on any version in the list to switch the file to that version.
6. A notification will appear confirming that the version switch is in progress.
7. Use the context menu (right-click) on files to access SOS commands.
8. Click the status bar button to pause/resume automatic status refresh.

## Configuration

- **Enable Debug Info**: Enable debug information output in console and status bar
  - Go to Settings → Extensions → ClioSoft SOS Manager
  - Toggle "Enable debug information output in console and status bar"

### Custom Commands

You can customize SOS commands in settings:
- `cliosoft-sos-manager.commands.checkout.command`: Custom checkout command
- `cliosoft-sos-manager.commands.checkin.command`: Custom checkin command
- `cliosoft-sos-manager.commands.diff.command`: Custom diff command
- `cliosoft-sos-manager.commands.discard.command`: Custom discard command
- `cliosoft-sos-manager.commands.update.command`: Custom update command
- `cliosoft-sos-manager.commands.createFile.command`: Custom create file command
- `cliosoft-sos-manager.soscmdTimeout`: SOS command timeout in seconds

Use these placeholders in custom commands:
- `${filePath}`: selected file path
- `${filePath1}` / `${filePath2}`: SOS revision pathnames used by Diff Two SOS Revisions
- `${revision1}` / `${revision2}`: selected SOS revision IDs

SOS `diff` accepts at most two pathnames of the **same file**. Multi-file Diff therefore runs `soscmd diff -gui <file>` once per file. Do not treat two different files as the two sides of one SOS diff.

## Troubleshooting

### Common Issues

**Q: Commands not working on Windows/Mac**
- A: This extension is designed for Linux only. You'll see a warning message when trying to use SOS commands on other platforms.

**Q: "File is not under SOS version control" error**
- A: Make sure the file is in a directory managed by ClioSoft SOS (contains `.sos` directory).

**Q: A file shows Modified (M) but "Discard" doesn't revert it**
- A: The file is modified *without a checkout* (SOS `-sncm` state, e.g. `f-M---`). `soscmd discard` only reverts files that are checked out, so there is nothing for it to discard. Use **Update** — the extension runs `soscmd updatesel -ccw`, a consistency-check Selective Update that restores the file and keeps the modified copy as `.SVM`.

**Q: Slow performance in large projects**
- A: Use the status bar toggle to pause automatic refresh when needed. Single-file SOS operations use targeted folder refresh; manual Changed Files refresh performs the full workspace scan and shows completion/failure notification. Debug logs include per-command timing and summarize large outputs.

**Q: Changed Files global scan has no result**
- A: Click the refresh button in the Changed Files view. The scan shows a notification when it completes or fails. The global scan uses documented SOS select options: `soscmd status * -sco -suco -sncm -sne -snt`.

### Debug Mode

Enable debug mode to see detailed logs:
1. Go to Settings → Extensions → ClioSoft SOS Manager
2. Enable "Enable Debug Info"
3. Open Output panel (View → Output)
4. Select "ClioSoft SOS" from the dropdown

## Performance Tips

- **Cache Duration**: Status is cached for 3 minutes to reduce server load
- **Pause Refresh**: Click the status bar to pause refresh when not needed
- **Batch Operations**: The extension automatically batches large operations (50 files per batch)

## Limitations

- The extension is designed to run on Linux environments.
- Some features may not work correctly on other operating systems.
- Only works with files managed by ClioSoft SOS.
- Automatic status refresh only occurs when VSCode window is focused.

## Development

### Prerequisites

- Node.js 14 or higher
- npm or yarn

### Building the Extension

1. Clone this repository.
2. Navigate to the repository directory.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the extension:
   ```bash
   npm run compile
   ```
5. To run the extension in debug mode:
   - Open the repository in VSCode.
   - Press F5 to start debugging.
   - A new VSCode window will open with the extension loaded.

### Packaging the Extension

1. Install VSCE (VSCode Extension Manager) globally:
   ```bash
   npm install -g vsce
   ```
2. Package the extension:
   ```bash
   vsce package
   ```
3. This will create a .vsix file in the repository directory.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues or questions:
1. Check [QUICK_FIX_GUIDE.md](QUICK_FIX_GUIDE.md) for common solutions
2. Enable debug mode and check the output panel
3. Open an issue on the GitHub repository with:
   - VSCode version
   - Extension version
   - Operating system
   - Debug logs (if applicable)

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

### v0.48.1 (Latest)
- Commands on files not under SOS version control are silently skipped instead of raising an error
- Discard prompt for files modified without checkout is now a modal dialog (cannot be missed)

### v0.48.0
- Quick-command shortcuts now work in non-text editors (e.g. Hex Editor) by resolving the active file from the active tab
- Discard detects files modified without checkout (`-sncm`) and routes them to Update (`soscmd updatesel -ccw`, consistency check, modified copy kept as `.SVM`) instead of reporting a false success

### v0.47.0
- Multi-file Diff (`soscmd diff -gui <file>` per file) and **Diff Two SOS Revisions** (`file/#/rev`)

### v0.45.0
- Added SOS create file context-menu command
- Added Changed Files full-scan success/failure notifications
- Fixed Changed Files global scan selector with documented SOS options (`-sco -suco -sncm -sne -snt`)
- Improved folder/file target handling for checkout, checkin, discard, and update
- Added SOS command timing and timeout diagnostics

- Major bug fixes and performance improvements
- User-friendly error messages
- Progress notifications
- 6x faster caching
- 60% better responsiveness

### v0.1.0
- Initial release with basic SOS integration
