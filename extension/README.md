# ClioSoft SOS Manager VSCode Extension

## Overview

This VSCode extension integrates with ClioSoft SOS Manager, allowing users to view and switch between different versions of the currently opened file directly from the VSCode sidebar.

## Features

- **File Versions Panel**: Displays a list of versions for the currently opened file in the VSCode sidebar.
- **Version Information**: Each version entry shows:
  - CI BY: The person who made the change
  - CI TIME: The time the change was made
  - Change summary: A description of the changes
- **Quick Version Switching**: Click on any version in the list to switch the current file to that version.
- **Auto-refresh**: The version list automatically refreshes when you switch to a different file.

## Requirements

- VSCode 1.85 or higher
- ClioSoft SOS Manager installed and configured on your system

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
2. Click on the ClioSoft SOS icon in the Activity Bar to open the sidebar panel.
3. The "File Versions" view will display a list of versions for the currently opened file.
4. Click on any version in the list to switch the file to that version.
5. A notification will appear confirming that the version switch is in progress.

## Configuration

Currently, there are no configuration options for this extension.

## Limitations

- The extension currently uses mock data for demonstration purposes. In a real implementation, it would connect to the ClioSoft SOS API.
- Only works with files managed by ClioSoft SOS.
- The version switching functionality is simulated and does not actually modify the file content.
- No support for comparing different versions of a file.
- No support for viewing detailed change information.

## Development

### Prerequisites

- Node.js 14 or higher
- npm or yarn

### Building the Extension

1. Clone this repository.
2. Navigate to the repository directory.
3. Install dependencies:
   ```
   npm install
   ```
4. Build the extension:
   ```
   npm run compile
   ```
5. To run the extension in debug mode:
   - Open the repository in VSCode.
   - Press F5 to start debugging.
   - A new VSCode window will open with the extension loaded.

### Packaging the Extension

1. Install the VSCE (VSCode Extension Manager) globally:
   ```
   npm install -g vsce
   ```
2. Package the extension:
   ```
   vsce package
   ```
3. This will create a .vsix file in the repository directory.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues or questions, please open an issue on the GitHub repository.
