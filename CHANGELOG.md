# Changelog

All notable changes to the "ClioSoft SOS Manager" extension will be documented in this file.

## [Unreleased]

## [0.47.0] - 2026-08-19

### Added

- Multi-file Diff now resolves Explorer / Changed Files multi-selection and runs `soscmd diff -gui <file>` once per file, with progress, cancel, and success/failure counts.
- Added **Diff Two SOS Revisions** to compare a file's workarea/checkout with one historical revision, or compare two revisions using `file/#/revision`.

### Changed

- Explorer context menu now shows Diff for `multipleResources`. Different files are never passed as the two sides of a single `soscmd diff`.

## [0.46.0] - 2026-08-13

### Changed

- File operations such as checkout/checkin/discard/create file no longer automatically trigger the expensive full-workspace Changed Files scan.
- After single-file operations, status refresh is limited to the current folder and ancestor folders to avoid Changed Files tree rebuild flicker in large workareas.
- Large SOS command stdout is summarized in debug logs instead of dumping full workspace status output.

### Fixed

- Reduced UI refresh/flicker after `soscmd status * -sco -suco -sncm -sne -snt` completes by keeping that scan manual-only for Changed Files refresh.
- Removed per-line successful `Parsing status line` debug logs that could flood the VS Code Output panel and make checkout appear stuck.

## [0.45.0] - 2026-08-12

### Added

- Added **SOS create file** command in right-click menus, executing `soscmd create <file_path>` for selected file targets.
- Added success/failure UI notifications for the Changed Files global refresh action.
- Added SOS command timing logs and command timeout support to help distinguish slow SOS execution from UI refresh delay.

### Changed

- Changed Files global scan now uses documented SOS select options:
  - `-sco`: checked out in this workarea
  - `-suco`: checked out without lock
  - `-sncm`: not checked out but modified
  - `-sne`: missing from workarea
  - `-snt`: needs update icon
- Folder and file command target handling is unified so file targets remain files and folder targets remain folders.
- Folder update now uses `updatesel` from the parent directory to avoid `soscmd update` ignoring pathnames and updating the whole workarea.
- File/folder status refresh now updates related folder state more consistently after commands.

### Fixed

- Removed unsupported `-snr` selector from the global Changed Files scan. SOSCMD select options are case-sensitive: `-sNr` is uppercase `N` and means "do not select recursively"; it is not the lowercase `-sn...` family.
- Fixed manually rolled-back files with new revision / modified markers disappearing from Changed Files after full scans.
- Reduced perceived stalls from repeated version-history requests by caching version history and timing SOS command execution.

## [0.3.0] - 2026-05-21

### Architecture — 源码模块拆分

将 `extension.ts`（1483 行）拆为职责清晰的四个模块，行为不变：

| 新文件 | 行数 | 职责 |
|--------|------|------|
| `fileStatusDecorator.ts` | 443 | 状态中心：statusCache、刷新编排、decoration / tree 通知、磁盘缓存 |
| `fileVersionsTree.ts` | 117 | 版本树视图：FileVersionItem + FileVersionsTreeDataProvider |
| `extension.ts` | ~850 | 总装层：activate、命令注册、事件订阅 wiring |
| `filteredStatusTree.ts` | 255 | Changed Files 只读投影（新增 reveal 支持方法） |

- `soscmd.ts`、`utils.ts` 逻辑不变

### Added — Changed Files 跟随激活文件

- 当编辑器切换到某个文件时，如果该文件存在于 Changed Files 树中，树视图会自动选中并跳转到该文件节点
- 仅在 Changed Files 面板可见时触发，不抢编辑器焦点（`focus: false`）
- 覆盖所有标签页切换入口：`onDidChangeActiveTextEditor`、`onDidChangeTabs`、fallback polling

### Added — 项目文档

- 新增 `doc/README.md`：完整项目文档，含简介、使用指南、全部配置项参考、源码架构六模块详解、数据流 / 刷新 / 缓存机制、构建打包说明、FAQ

### Technical Details

- `FilteredStatusTreeDataProvider` 新增 `getParent()`、`findItem()`、`hasFile()` 方法以支持 `TreeView.reveal()`
- `FilteredStatusItem` 添加 `id = absolutePath` 属性，确保 reveal 能正确匹配节点
- `filteredTreeView` 变量从 if 块内提升为函数作用域，供 `revealInFilteredTree()` 闭包访问

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
