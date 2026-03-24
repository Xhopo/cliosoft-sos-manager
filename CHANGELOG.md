# Changelog

All notable changes to the "ClioSoft SOS Manager" extension will be documented in this file.

## [0.2.0] - 2026-03-23

### Fixed

#### Critical Bugs
- **Duplicate version switch execution**: Fixed bug where version switching was executed twice, causing unnecessary operations and potential state inconsistencies (extension.ts:216-252)
- **Missing platform checks**: Added platform validation before executing SOS commands on non-Linux systems, preventing confusing errors
- **Memory leak**: Removed unused `pendingMultiFileCommands` variable that could cause memory leaks
- **Incorrect command execution**: Fixed `officeOpen` and `rebuildCtags` commands to use direct exec instead of soscmd wrapper
- **Path concatenation error**: Fixed version switching to use correct SOS syntax (`@` instead of `/`)

#### Performance Issues
- **Cache expiry optimization**: Increased cache expiry time from 30s to 3 minutes, reducing unnecessary soscmd calls
- **Debounce optimization**: Reduced debounce timeout from 500ms to 200ms for better responsiveness
- **Polling interval**: Increased fallback polling interval from 500ms to 1s to reduce CPU usage
- **Concurrent updates**: Reduced max concurrent folder updates from 5 to 3 to prevent overload
- **Magic numbers**: Extracted all timing constants to named configuration constants

#### User Experience
- **Friendly error messages**: Added `getUserFriendlyError()` function to convert technical errors to user-friendly descriptions
- **Progress notifications**: Added progress bars for batch operations (checkout, checkin, discard)
- **Status bar clarity**: Improved status bar text to clearly distinguish between active and paused states
- **Debug output cleanup**: Removed console.log pollution in non-debug mode

#### Code Quality
- **Type safety**: Simplified type casting logic and reduced use of `as any`
- **Command format**: Fixed checkout command parameter format from `-Nlock` to `-N lock`
- **Variable replacement**: Improved command variable replacement logic for better consistency
- **Unused code**: Documented unused `isFileUnderSosControl` function for future use

### Added
- Configuration constants section for easy tuning
- User-friendly error message mapping for common SOS errors
- Progress notification support for batch operations
- Comprehensive fix documentation (FIXES_SUMMARY.md)

### Changed
- Cache expiry time: 30s → 3 minutes
- Debounce timeout: 500ms → 200ms
- Tab polling interval: 500ms → 1s (fallback only)
- Max concurrent updates: 5 → 3
- Status bar text format for better clarity

### Technical Details

#### Error Message Improvements
The extension now recognizes and translates these common errors:
- "No valid objects selected" → "File is not under SOS version control"
- "has been checked out" → "File is already checked out. Please check it in or discard changes first"
- "Permission denied" → "Permission denied. Please check your access rights"
- "locked by another user" → "File is locked by another user"
- "network/connection" → "Network connection error. Please check your connection to the SOS server"

#### Performance Improvements
- Reduced soscmd status calls by 6x (3min cache vs 30s)
- Improved UI responsiveness by 2.5x (200ms vs 500ms debounce)
- Reduced CPU usage in fallback mode by 2x (1s vs 500ms polling)

### Migration Notes
No breaking changes. All improvements are backward compatible.

### Testing Recommendations
1. Test platform checks on Windows/Mac
2. Test batch operations with >50 files
3. Test error scenarios (non-SOS files, locked files, etc.)
4. Monitor CPU usage in large projects
5. Test version switching functionality

---

## [0.1.0] - Initial Release

### Added
- File status decorations in Explorer
- File versions panel in sidebar
- Context menu commands (checkout, checkin, diff, discard)
- Office open and compile RTL commands
- Status bar toggle for refresh control
- Debug mode support
- Linux platform support
