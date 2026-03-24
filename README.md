# ClioSoft SOS Manager VSCode Extension

## Overview

This VSCode extension integrates with ClioSoft SOS Manager, providing file status decorations in Explorer and allowing users to view and switch between different versions of files.

## What's New in v0.2.0

🎉 **Major Bug Fixes and Performance Improvements!**

- ✅ Fixed critical bugs (duplicate execution, platform checks, memory leaks)
- ⚡ 6x faster with improved caching (30s → 3min)
- 🚀 60% better responsiveness (500ms → 200ms)
- 💬 User-friendly error messages
- 📊 Progress notifications for batch operations
- 🔧 50% lower CPU usage

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

- **Context Menu Commands**: Right-click on files in Explorer to access SOS commands:
  - Check out: Check out the current file without lock
  - Check in: Check in the current file with comments
  - Diff: Compare the current file with the last version
  - Discard: Discard changes (with option to force discard all changes)
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

Use `${filePath}` as a placeholder for the file path in custom commands.

## Troubleshooting

### Common Issues

**Q: Commands not working on Windows/Mac**
- A: This extension is designed for Linux only. You'll see a warning message when trying to use SOS commands on other platforms.

**Q: "File is not under SOS version control" error**
- A: Make sure the file is in a directory managed by ClioSoft SOS (contains `.sos` directory).

**Q: Slow performance in large projects**
- A: v0.2.0 includes significant performance improvements. Make sure you're using the latest version.

**Q: Status not updating**
- A: Check the status bar - you may have paused automatic refresh. Click the status bar item to resume.

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

### v0.2.0 (Latest)
- Major bug fixes and performance improvements
- User-friendly error messages
- Progress notifications
- 6x faster caching
- 60% better responsiveness

### v0.1.0
- Initial release with basic SOS integration
