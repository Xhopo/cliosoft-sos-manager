# ClioSoft SOS Manager VSCode Extension

## Overview

This VSCode extension integrates with ClioSoft SOS Manager, providing file status decorations in Explorer and allowing users to view and switch between different versions of files.

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

For issues or questions, please open an issue on the GitHub repository.
