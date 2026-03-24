import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { FileStatus, getFolderStatus, getFileVersions, switchFileVersion, executeSoscmd, FileVersion, getFileStatus, getRecursiveFolderStatus } from './soscmd';
import { isDebugEnabled, logDebug, logError, isCommandEnabled, getCommandConfig, replaceCommandVariables, BATCH_SIZE, isPlatformSupported, showPlatformWarning } from './utils';
import { FilteredStatusTreeDataProvider } from './filteredStatusTree';

const execAsync = promisify(exec);

// Configuration constants
const CACHE_EXPIRY_TIME = 180000; // 3 minutes cache expiry
const DEBOUNCE_TIMEOUT = 200; // 200ms debounce for better responsiveness
const TAB_POLLING_INTERVAL = 1000; // 1 second polling interval (fallback only)
const STATUS_REFRESH_INTERVAL = 5000; // 5 seconds status refresh
const BATCH_PROCESSING_DELAY = 200; // 200ms delay between batches
const MAX_CONCURRENT_UPDATES = 3; // Reduced concurrent updates to avoid overload

/**
 * 版本切换后重新加载编辑器中的文件，消除"未保存"标记。
 * SOS userev 直接修改了磁盘文件，但 VSCode 编辑器仍持有旧内容，
 * 导致内存内容与磁盘不一致，标签页出现 dirty dot。
 * 这里通过 revert 让编辑器重新从磁盘读取文件。
 */
async function revertFileInEditor(filePath: string): Promise<void> {
    const fileUri = vscode.Uri.file(filePath);
    // 找到该文件对应的已打开文档
    const doc = vscode.workspace.textDocuments.find(
        d => d.uri.fsPath === fileUri.fsPath
    );
    if (doc && doc.isDirty) {
        // 先让该文档成为活动编辑器，revert 命令作用于活动编辑器
        const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
        if (editor) {
            await vscode.commands.executeCommand('workbench.action.files.revert');
            logDebug(`Reverted file in editor: ${filePath}`);
        }
    }
}

/**
 * 从命令参数中提取 Uri 数组。
 * 兼容四种调用来源：
 *  1. Explorer 右键菜单：(uri: Uri, uris: Uri[])
 *  2. Changed Files 树视图右键单选：(treeItem, [treeItem])
 *  3. Changed Files 树视图多选：(treeItem, [treeItem, treeItem, ...])
 *  4. 无参数（快捷键）：取 activeTextEditor
 *
 * 对于树视图中的文件夹节点，展开为该文件夹下所有 interesting 文件。
 */
function resolveCommandUris(arg0: any, arg1: any): vscode.Uri[] {
    // 来源 1: Explorer 多选 — arg1 是 Uri[]
    if (Array.isArray(arg1) && arg1.length > 0 && arg1[0] instanceof vscode.Uri) {
        return arg1;
    }

    // 来源 2/3: 树视图多选 — arg1 是 TreeItem[]
    if (Array.isArray(arg1) && arg1.length > 0 && !(arg1[0] instanceof vscode.Uri)) {
        const uris: vscode.Uri[] = [];
        for (const item of arg1) {
            if (item.isDirectory === true && item.absolutePath && _filteredTreeProvider) {
                uris.push(..._filteredTreeProvider.getInterestingFileUris(item.absolutePath));
            } else if (item.resourceUri instanceof vscode.Uri) {
                uris.push(item.resourceUri);
            }
        }
        // 去重
        const seen = new Set<string>();
        return uris.filter(u => {
            if (seen.has(u.fsPath)) { return false; }
            seen.add(u.fsPath);
            return true;
        });
    }

    // 来源 1: Explorer 单选
    if (arg0 instanceof vscode.Uri) {
        return [arg0];
    }
    // 树视图单选 — 文件夹节点
    if (arg0 && arg0.isDirectory === true && arg0.absolutePath && _filteredTreeProvider) {
        return _filteredTreeProvider.getInterestingFileUris(arg0.absolutePath);
    }
    // 树视图单选 — 文件节点
    if (arg0 && arg0.resourceUri instanceof vscode.Uri) {
        return [arg0.resourceUri];
    }
    // 来源 4: 无参数，取活动编辑器
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        return [editor.document.uri];
    }
    return [];
}

// 模块级引用，供 resolveCommandUris 访问
let _filteredTreeProvider: import('./filteredStatusTree').FilteredStatusTreeDataProvider | undefined;

// 刷新文件状态，确保VSCode与SOS状态一致
async function refreshFileStatus(filePaths: string[]): Promise<void> {
    // 收集所有不重复的文件夹路径
    const folders = new Set(filePaths.map(p => path.dirname(p)));
    folders.forEach(f => fileStatusDecorator.clearFolderCache(f));

    for (const filePath of filePaths) {
        const fileUri = vscode.Uri.file(filePath);
        try {
            await vscode.workspace.fs.stat(fileUri);
            if (fileStatusDecorator) {
                fileStatusDecorator.updateFileAndAncestors(filePath);
            }
            logDebug(`Completed file status refresh for ${filePath}`);
        } catch (error) {
            logError(`Failed to refresh file status for ${filePath}:`, error);
        }
    }
    await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
}

async function executeBatchCommand(
    filePaths: string[],
    fileDir: string,
    buildCommand: (batch: string[]) => string,
    commandName: string
): Promise<{ successCount: number; failCount: number; errors: any[] }> {
    const results = { successCount: 0, failCount: 0, errors: [] as any[] };

    // Show progress notification for batch operations
    if (filePaths.length > 1) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `${commandName} ${filePaths.length} files...`,
            cancellable: false
        }, async (progress) => {
            return executeBatchCommandWithProgress(filePaths, fileDir, buildCommand, commandName, results, progress);
        });
    } else {
        // Single file operation without progress
        const command = buildCommand(filePaths);
        logDebug(`${commandName} command:`, command);
        try {
            await executeSoscmd(command, fileDir);
            results.successCount = filePaths.length;
        } catch (error) {
            results.failCount = filePaths.length;
            results.errors.push(error);
            vscode.window.showErrorMessage(`${commandName} failed: ${error}`);
        }
    }

    return results;
}

async function executeBatchCommandWithProgress(
    filePaths: string[],
    fileDir: string,
    buildCommand: (batch: string[]) => string,
    commandName: string,
    results: { successCount: number; failCount: number; errors: any[] },
    progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
    const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);
    logDebug(`${commandName}: Processing ${filePaths.length} files in ${totalBatches} batches`);

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const command = buildCommand(batch);

        logDebug(`${commandName} batch ${batchNum}/${totalBatches}:`, command);

        progress.report({
            message: `Processing batch ${batchNum}/${totalBatches}`,
            increment: (100 / totalBatches)
        });

        try {
            await executeSoscmd(command, fileDir);
            results.successCount += batch.length;
        } catch (error) {
            results.failCount += batch.length;
            results.errors.push(error);
            logError(`${commandName} batch ${batchNum}/${totalBatches} failed: ${error}`);
        }
    }
}

// 定义文件版本树节点
class FileVersionItem extends vscode.TreeItem {
    public readonly version: FileVersion | null;
    public readonly filePath: string | null;
    public readonly isCurrent: boolean;

    constructor(
        version: FileVersion | null,
        filePath: string | null,
        isCurrent: boolean = false,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(version ? version.id : 'No versions', collapsibleState);
        
        this.version = version;
        this.filePath = filePath;
        this.isCurrent = isCurrent;
        
        if (version === null) {
            this.tooltip = 'No versions available';
            this.description = '';
            this.contextValue = 'noVersions';
            this.iconPath = 'info';
        } else {
            this.tooltip = `Version ${version.id} - ${version.ciBy} - ${version.ciTime}\n${version.changeSummary}`;
            this.description = `${version.changeSummary}`;
            this.contextValue = 'fileVersion';
            
            if (isCurrent) {
                this.iconPath = new vscode.ThemeIcon('check');
                this.description = 'Current';
            } else {
                this.iconPath = new vscode.ThemeIcon('circle-outline');
            }
            
            this.command = {
                title: 'Switch to This Version',
                command: 'cliosoft-sos-manager.switchVersion',
                arguments: [filePath, version]
            };
        }
    }
}

// 文件版本树数据提供程序
class FileVersionsTreeDataProvider implements vscode.TreeDataProvider<FileVersionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileVersionItem | undefined | null> = new vscode.EventEmitter<FileVersionItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<FileVersionItem | undefined | null> = this._onDidChangeTreeData.event;
    private currentFilePath: string | null = null;
    private currentFileStatus: FileStatus | null = null;

    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }

    async setFile(filePath: string): Promise<void> {
        this.currentFilePath = filePath;
        
        this.currentFileStatus = await getFileStatus(filePath);
        
        if (isDebugEnabled()) {
            logDebug(`File set to: ${filePath}`);
            logDebug(`File status: ${JSON.stringify(this.currentFileStatus)}`);
        }
        
        this.refresh();
    }

    getTreeItem(element: FileVersionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileVersionItem): Promise<FileVersionItem[]> {
        if (isDebugEnabled()) {
            logDebug(`getChildren called with element: ${element?.label}`);
        }
        
        if (!element) {
            if (!this.currentFilePath) {
                if (isDebugEnabled()) {
                    logDebug('No file selected, returning noVersions item');
                }
                return [new FileVersionItem(null, null, false)];
            }

            if (isDebugEnabled()) {
                logDebug(`Active file: ${this.currentFilePath}`);
            }
            
            const versions = await getFileVersions(this.currentFilePath);
            if (isDebugEnabled()) {
                logDebug(`getFileVersions returned ${versions.length} versions`);
            }

            if (versions.length === 0) {
                if (isDebugEnabled()) {
                    logDebug(`No versions found, returning noVersions item`);
                }
                return [new FileVersionItem(null, this.currentFilePath, false)];
            }

            if (isDebugEnabled()) {
                logDebug(`Creating FileVersionItems for ${versions.length} versions`);
            }
            
            const currentRevision = this.currentFileStatus?.revision || '';
            return versions.map(version => 
                new FileVersionItem(version, this.currentFilePath, version.id === currentRevision)
            );
        }

        return [];
    }
}

export function activate(context: vscode.ExtensionContext) {
    if (isDebugEnabled()) {
        logDebug('ClioSoft SOS Manager extension activating...');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activating...');
    }
    
    const treeDataProvider = new FileVersionsTreeDataProvider();
    if (isDebugEnabled()) {
        logDebug('Tree data provider created');
    }

    vscode.window.registerTreeDataProvider('cliosoft-sos-manager.fileVersions', treeDataProvider);
    if (isDebugEnabled()) {
        logDebug('Tree view provider registered');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.refreshVersions', () => {
            if (isDebugEnabled()) {
                logDebug('Refresh versions command executed');
                vscode.window.showInformationMessage('[DEBUG] Refresh versions command executed');
            }
            treeDataProvider.refresh();
        })
    );
    if (isDebugEnabled()) {
        logDebug('Refresh command registered');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.switchVersion', async (filePath: string | null, version: FileVersion | null) => {
            if (isDebugEnabled()) {
                logDebug(`Switch version command executed with filePath: ${filePath}, version: ${version?.id}`);
                vscode.window.showInformationMessage(`[DEBUG] Switch version command: ${filePath} -> v${version?.id}`);
            }

            if (filePath && version) {
                if (isDebugEnabled()) {
                    logDebug(`Calling switchFileVersion for ${filePath} with version ${version.id}`);
                }

                // 执行版本切换
                await switchFileVersion(filePath, version.id);

                // 清除该文件所在文件夹的缓存
                const folder = path.dirname(filePath);
                fileStatusDecorator.clearFolderCache(folder);

                // 重新加载文件内容，消除标签页"未保存"标记
                await revertFileInEditor(filePath);

                // 更新文件及其祖先
                await treeDataProvider.setFile(filePath);
                fileStatusDecorator.updateFileAndAncestors(filePath);

                if (isDebugEnabled()) {
                    logDebug(`Version switch completed and UI refreshed`);
                }
            } else {
                logError(`Invalid parameters for switchVersion: filePath=${filePath}, version=${version}`);
            }
        })
    );
    if (isDebugEnabled()) {
        logDebug('Switch version command registered');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkout', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('checkout')) {
                logDebug('Checkout command is disabled');
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                logDebug('No file paths to process');
                return;
            }

            const filePaths = targetUris.map(u => u.fsPath);
            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(p => path.basename(p)).join(', ');
            
            logDebug('Working directory:', fileDir);
            logDebug('File names:', fileNames);
            
            const results = await executeBatchCommand(
                filePaths,
                fileDir,
                (batch) => {
                    let command = getCommandConfig('checkout');
                    if (!command) {
                        return 'soscmd co -Nlock ' + batch.map(p => `"${p}"`).join(' ');
                    } else {
                        return replaceCommandVariables(command, { filePath: batch });
                    }
                },
                'Checkout'
            );
            
            if (results.failCount === 0) {
                vscode.window.showInformationMessage(`Checked out: ${fileNames}`);
                logDebug('Checkout command completed successfully');
            } else {
                vscode.window.showWarningMessage(`Checked out ${results.successCount} files, ${results.failCount} failed.`);
                logDebug(`Checkout command completed with ${results.successCount} successes and ${results.failCount} failures`);
            }
            
            await refreshFileStatus(filePaths);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkin', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('checkin')) {
                logDebug('Checkin command is disabled');
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                logDebug('No file paths to process');
                return;
            }

            const filePaths = targetUris.map(u => u.fsPath);

            const comments = await vscode.window.showInputBox({
                prompt: 'Enter check-in comments',
                placeHolder: 'Describe your changes...',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Comments cannot be empty';
                    }
                    return null;
                }
            });

            if (!comments) {
                return;
            }

            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(p => path.basename(p)).join(', ');
            
            logDebug('Working directory:', fileDir);
            logDebug('File names:', fileNames);
            
            const results = await executeBatchCommand(
                filePaths,
                fileDir,
                (batch) => {
                    let command = getCommandConfig('checkin');
                    if (!command) {
                        return 'soscmd ci -aLog="' + comments + '" ' + batch.map(p => `"${p}"`).join(' ');
                    } else {
                        return replaceCommandVariables(command, { filePath: batch, comments });
                    }
                },
                'Checkin'
            );
            
            if (results.failCount === 0) {
                vscode.window.showInformationMessage(`Checked in: ${fileNames}`);
                logDebug('Checkin command completed successfully');
            } else {
                vscode.window.showWarningMessage(`Checked in ${results.successCount} files, ${results.failCount} failed.`);
                logDebug(`Checkin command completed with ${results.successCount} successes and ${results.failCount} failures`);
            }
            
            await refreshFileStatus(filePaths);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.diff', async (arg0: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('diff')) {
                return;
            }

            const targetUris = resolveCommandUris(arg0, undefined);
            if (targetUris.length === 0) {
                return;
            }

            const filePath = targetUris[0].fsPath;
            const fileDir = path.dirname(filePath);

            if (isDebugEnabled()) {
                logDebug(`Diff command executed for: ${filePath}`);
            }

            let command = getCommandConfig('diff');
            if (!command) {
                command = `soscmd diff -gui "${filePath}"`;
            }

            command = replaceCommandVariables(command, { filePath });
            await executeSoscmd(command, fileDir);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.discard', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('discard')) {
                logDebug('Discard command is disabled');
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                logDebug('No file paths to process');
                return;
            }

            const filePaths = targetUris.map(u => u.fsPath);

            const selectedOption = await vscode.window.showQuickPick([
                { label: 'Yes (discard all changes)', value: true },
                { label: 'No (keep local changes)', value: false }
            ], {
                placeHolder: 'Do you want to use -F parameter to discard all changes?',
                title: 'Discard Changes'
            });

            if (!selectedOption) {
                return;
            }

            const useForce = selectedOption.value;

            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(p => path.basename(p)).join(', ');
            
            logDebug('Working directory:', fileDir);
            logDebug('File names:', fileNames);
            
            const results = await executeBatchCommand(
                filePaths,
                fileDir,
                (batch) => {
                    let command = getCommandConfig('discard');
                    if (!command) {
                        return 'soscmd discard ' + (useForce ? '-F' : '') + ' ' + batch.map(p => `"${p}"`).join(' ');
                    } else {
                        return replaceCommandVariables(command, { filePath: batch, useForce: useForce ? '-F' : '' });
                    }
                },
                'Discard'
            );
            
            if (results.failCount === 0) {
                vscode.window.showInformationMessage(`Discarded: ${fileNames}`);
                logDebug('Discard command completed successfully');
            } else {
                vscode.window.showWarningMessage(`Discarded ${results.successCount} files, ${results.failCount} failed.`);
                logDebug(`Discard command completed with ${results.successCount} successes and ${results.failCount} failures`);
            }
            
            await refreshFileStatus(filePaths);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.officeOpen', async (uri: vscode.Uri) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }

            if (!isCommandEnabled('officeOpen')) {
                return;
            }

            let filePath: string;
            if (uri) {
                filePath = uri.fsPath;
            } else {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }
                filePath = editor.document.uri.fsPath;
            }

            const fileDir = path.dirname(filePath);

            if (isDebugEnabled()) {
                logDebug(`Office open command executed for: ${filePath}`);
            }

            try {
                let command = getCommandConfig('officeOpen');
                if (!command) {
                    command = `soffice "${filePath}"`;
                } else {
                    command = replaceCommandVariables(command, { filePath });
                }

                // Use exec directly instead of executeSoscmd for non-SOS commands
                await execAsync(command, { cwd: fileDir });
                vscode.window.showInformationMessage(`Opened file in office application`);
            } catch (error) {
                const errorMsg = `Failed to open file: ${error instanceof Error ? error.message : String(error)}`;
                logError(errorMsg);
                vscode.window.showErrorMessage(errorMsg);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.rebuildCtags', async (uri: vscode.Uri) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }

            if (!isCommandEnabled('rebuildCtags')) {
                return;
            }

            let filePath: string;
            if (uri) {
                filePath = uri.fsPath;
            } else {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }
                filePath = editor.document.uri.fsPath;
            }

            const fileDir = path.dirname(filePath);

            if (isDebugEnabled()) {
                logDebug(`Rebuild ctags command executed for: ${filePath}`);
            }

            try {
                let command = getCommandConfig('rebuildCtags');
                if (!command) {
                    const projRoot = process.env.PROJ_ROOT || fileDir;
                    command = `cd "${projRoot}" && ctags -R --fields=+nKz -f .vscode/.tags --langmap=SystemVerilog:+.v+.sv -R --links=yes ./design_data/rtl ./design_data/testbench ./ref_ip`;
                } else {
                    command = replaceCommandVariables(command, { filePath });
                }

                // Use exec directly instead of executeSoscmd for non-SOS commands
                vscode.window.showInformationMessage('Rebuilding ctags...');
                await execAsync(command, { cwd: fileDir });
                vscode.window.showInformationMessage('Ctags rebuilt successfully');
            } catch (error) {
                const errorMsg = `Failed to rebuild ctags: ${error instanceof Error ? error.message : String(error)}`;
                logError(errorMsg);
                vscode.window.showErrorMessage(errorMsg);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.toggleRefresh', () => {
            fileStatusDecorator.toggleRefresh();
        })
    );

    // Quick commands for active editor file (keybinding targets)
    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.quickCheckout', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active file to check out');
                return;
            }
            await vscode.commands.executeCommand(
                'cliosoft-sos-manager.checkout',
                editor.document.uri,
                [editor.document.uri]
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.quickCheckin', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active file to check in');
                return;
            }
            await vscode.commands.executeCommand(
                'cliosoft-sos-manager.checkin',
                editor.document.uri,
                [editor.document.uri]
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.quickDiscard', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active file to discard');
                return;
            }
            await vscode.commands.executeCommand(
                'cliosoft-sos-manager.discard',
                editor.document.uri,
                [editor.document.uri]
            );
        })
    );

    fileStatusDecorator = new FileStatusDecorator();
    // 新增：初始化刷新
    vscode.workspace.textDocuments.forEach(doc => {
        const filePath = doc.uri.fsPath;
        if (filePath) {
            fileStatusDecorator.updateFileAndAncestors(filePath);
        }
    });
    if (vscode.window.activeTextEditor) {
        treeDataProvider.setFile(vscode.window.activeTextEditor.document.uri.fsPath);
    }

    // Changed Files 过滤树视图
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let filteredTreeProvider: FilteredStatusTreeDataProvider | undefined;

    if (workspaceRoot) {
        filteredTreeProvider = new FilteredStatusTreeDataProvider(
            workspaceRoot,
            fileStatusDecorator.fileStatusCache
        );
        _filteredTreeProvider = filteredTreeProvider;

        const filteredTreeView = vscode.window.createTreeView(
            'cliosoft-sos-manager.filteredStatus',
            { treeDataProvider: filteredTreeProvider, showCollapseAll: true, canSelectMany: true }
        );
        context.subscriptions.push(filteredTreeView);

        // 状态缓存更新时重建过滤树
        context.subscriptions.push(
            fileStatusDecorator.onDidUpdateStatus(() => {
                filteredTreeProvider!.rebuild();
            })
        );

        // 刷新命令：全量递归扫描工作区
        context.subscriptions.push(
            vscode.commands.registerCommand('cliosoft-sos-manager.refreshFilteredStatus', async () => {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Scanning workspace for SOS status...',
                        cancellable: true
                    },
                    async (progress, token) => {
                        await fileStatusDecorator.performFullWorkspaceScan(
                            workspaceRoot, progress, token
                        );
                    }
                );
            })
        );

        // 视图首次可见且树为空时自动触发扫描
        context.subscriptions.push(
            filteredTreeView.onDidChangeVisibility(e => {
                if (e.visible && filteredTreeProvider!.isEmpty()) {
                    vscode.commands.executeCommand('cliosoft-sos-manager.refreshFilteredStatus');
                }
            })
        );
    }

    // 监听文本编辑器变化（文本文件）
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document) {
                fileStatusDecorator.updateFileAndAncestors(editor.document.uri.fsPath);
                treeDataProvider.setFile(editor.document.uri.fsPath);
            }
        })
    );
    
    // 监听文件保存事件
    // context.subscriptions.push(
    //     vscode.workspace.onDidSaveTextDocument((document) => {
    //         fileStatusDecorator.updateFileAndAncestors(document.uri.fsPath);
    //     })
    // );
    
    // 监听文件打开事件
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            fileStatusDecorator.updateFileAndAncestors(document.uri.fsPath);
        })
    );
    
    // 监听资源管理器中的文件选择变化（包括非文本文件如.xlsx）
    // 使用VSCode的Tab Groups API来监听所有类型的标签页变化
    let lastActiveTab: string | undefined;
    
    // 监听标签页变化事件（文本编辑器）
    const tabChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document) {
            const currentFile = editor.document.uri.fsPath;
            if (currentFile !== lastActiveTab) {
                lastActiveTab = currentFile;
                fileStatusDecorator.updateFileAndAncestors(currentFile);
                treeDataProvider.setFile(currentFile);
            }
        }
    });
    context.subscriptions.push(tabChangeListener);
    
    // 使用VSCode的Tab Groups API事件来监听标签页变化（替代轮询）
    if (vscode.window.tabGroups && vscode.window.tabGroups.onDidChangeTabs) {
        const tabGroupsListener = vscode.window.tabGroups.onDidChangeTabs(() => {
            try {
                const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
                if (activeTab && activeTab.input) {
                    let filePath: string | undefined;

                    const input = activeTab.input as any;
                    if (input.uri) {
                        filePath = input.uri.fsPath;
                    }

                    if (filePath && filePath !== lastActiveTab) {
                        lastActiveTab = filePath;
                        fileStatusDecorator.updateFileAndAncestors(filePath);
                        treeDataProvider.setFile(filePath);

                        if (isDebugEnabled()) {
                            logDebug(`Active tab changed to: ${filePath}`);
                        }
                    }
                }
            } catch (error) {
                if (isDebugEnabled()) {
                    logError(`Failed to check active tab:`, error);
                }
            }
        });
        context.subscriptions.push(tabGroupsListener);
    } else {
        if (isDebugEnabled()) {
            logDebug('tabGroups.onDidChangeTabs not available, using fallback polling');
        }

        const tabChangeInterval = setInterval(async () => {
            try {
                const tabGroups = vscode.window.tabGroups;
                if (tabGroups && tabGroups.activeTabGroup) {
                    const activeTab = tabGroups.activeTabGroup.activeTab;
                    if (activeTab && activeTab.input) {
                        let filePath: string | undefined;

                        const input = activeTab.input as any;
                        if (input.uri) {
                            filePath = input.uri.fsPath;
                        }

                        if (filePath && filePath !== lastActiveTab) {
                            lastActiveTab = filePath;
                            fileStatusDecorator.updateFileAndAncestors(filePath);
                            treeDataProvider.setFile(filePath);

                            if (isDebugEnabled()) {
                                logDebug(`Active tab changed to: ${filePath}`);
                            }
                        }
                    }
                }
            } catch (error) {
                if (isDebugEnabled()) {
                    logError(`Failed to check active tab:`, error);
                }
            }
        }, TAB_POLLING_INTERVAL);

        context.subscriptions.push({
            dispose: () => {
                clearInterval(tabChangeInterval);
            }
        });
    }
    
    const isLinux = process.platform === 'linux';
    
    if (!isLinux) {
        vscode.window.showWarningMessage('This extension is designed to run on Linux only. Some features may not work correctly.');
    }
    
    const statusRefreshInterval = setInterval(async () => {
        if (!isLinux) {
            return;
        }

        if (!vscode.window.state.focused) {
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document) {
            fileStatusDecorator.updateFileAndAncestors(activeEditor.document.uri.fsPath);
        }
    }, STATUS_REFRESH_INTERVAL);
    
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            fileStatusDecorator.clearCache();
        })
    );
    
    // 添加文件变化监听器，实时更新文件状态
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            const filePath = event.document.uri.fsPath;
            if (isDebugEnabled()) {
                logDebug(`File changed: ${filePath}`);
            }
            // 清除该文件所在文件夹的缓存
            if (fileStatusDecorator) {
                const folderPath = path.dirname(filePath);
                fileStatusDecorator.clearFolderCache(folderPath);
                // 更新文件状态
                fileStatusDecorator.updateFileAndAncestors(filePath);
            }
        })
    );
    
    // 添加文件保存监听器
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const filePath = document.uri.fsPath;
            if (isDebugEnabled()) {
                logDebug(`File saved: ${filePath}`);
            }
            // 清除该文件所在文件夹的缓存
            if (fileStatusDecorator) {
                const folderPath = path.dirname(filePath);
                fileStatusDecorator.clearFolderCache(folderPath);
                // 更新文件状态
                fileStatusDecorator.updateFileAndAncestors(filePath);
            }
        })
    );
    
    context.subscriptions.push({
        dispose: () => {
            clearInterval(statusRefreshInterval);
        }
    });
    
    if (isDebugEnabled()) {
        logDebug('ClioSoft SOS Manager extension activated!');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activated!');
    }
}

export function deactivate() {
    logDebug('ClioSoft SOS Manager extension deactivated!');
    
    if (fileStatusDecorator) {
        fileStatusDecorator.dispose();
    }
}

class FileStatusDecorator {
    private statusCache: Map<string, FileStatus> = new Map();
    private folderStatusCache: Map<string, { statusMap: Map<string, FileStatus>, timestamp: number }> = new Map();
    private updatingFolders: Set<string> = new Set();
    private periodicUpdateTimer: NodeJS.Timeout | undefined;
    private readonly maxConcurrentUpdates = MAX_CONCURRENT_UPDATES;
    private readonly decorationChangeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    private readonly _onDidUpdateStatus = new vscode.EventEmitter<void>();
    readonly onDidUpdateStatus: vscode.Event<void> = this._onDidUpdateStatus.event;
    private fileDecorationProvider: vscode.FileDecorationProvider;
    private fileDecorationProviderRegistration: vscode.Disposable | undefined;
    private isPaused: boolean = false;
    private statusBarItem: vscode.StatusBarItem;
    private readonly cacheExpiryTime = CACHE_EXPIRY_TIME;
    private readonly debounceTimeout = DEBOUNCE_TIMEOUT;
    private debounceTimer: NodeJS.Timeout | undefined;
    
    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem('cliosoft-sos-manager.refreshToggle', vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = '$(sync) SOS: Active';
        this.statusBarItem.command = 'cliosoft-sos-manager.toggleRefresh';
        this.statusBarItem.tooltip = 'SOS status refresh is active. Click to pause.';
        this.statusBarItem.show();
        
        this.fileDecorationProvider = {
            provideFileDecoration: (uri: vscode.Uri) => {
                const filePath = uri.fsPath;
                const status = this.statusCache.get(filePath);
                
                if (!status) {
                    return undefined;
                }
                
                let badge = '';
                let color = undefined;
                let tooltip = '';
                
                if (status.state === 'O' || status.state === 'W') {
                    badge = '🔑';
                    color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
                    tooltip = 'Checked Out';
                    if (status.change === 'M') {
                        badge += '✏️';
                        color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
                        tooltip = 'Modified';
                    }
                } else if (status.state === '-') {
                    badge = '🔒';
                    color = new vscode.ThemeColor('gitDecoration.untrackedResourceForeground');
                    tooltip = 'Checked In (Locked)';
                }
                
                if (status.newRevision === 'N') {
                    badge += '⚠️';
                    color = new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
                    tooltip += ' (Has New Revision)';
                }
                
                if (badge) {
                    return {
                        badge,
                        color,
                        tooltip
                    };
                }
                
                return undefined;
            },
            onDidChangeFileDecorations: this.decorationChangeEmitter.event
        };
        
        this.fileDecorationProviderRegistration = vscode.window.registerFileDecorationProvider(this.fileDecorationProvider);
    }
    
    /**
     * 暴露 statusCache 供 FilteredStatusTreeDataProvider 读取
     */
    get fileStatusCache(): Map<string, FileStatus> {
        return this.statusCache;
    }

    /**
     * 全量递归扫描工作区，填充 statusCache
     */
    async performFullWorkspaceScan(
        workspaceRoot: string,
        progress?: vscode.Progress<{ message?: string }>,
        cancellationToken?: vscode.CancellationToken
    ): Promise<void> {
        let scannedCount = 0;
        await getRecursiveFolderStatus(
            workspaceRoot,
            (folderPath, statusMap) => {
                this.folderStatusCache.set(folderPath, {
                    statusMap,
                    timestamp: Date.now()
                });
                statusMap.forEach((status, filePath) => {
                    this.statusCache.set(filePath, status);
                });
                scannedCount++;
                progress?.report({ message: `Scanned ${scannedCount} folders...` });
            },
            cancellationToken
        );
        // 扫描完成后通知装饰器刷新 + 通知过滤树重建
        this.decorationChangeEmitter.fire(undefined);
        this._onDidUpdateStatus.fire();
    }

    toggleRefresh(): void {
        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            this.statusBarItem.text = '$(debug-pause) SOS: Paused';
            this.statusBarItem.tooltip = 'SOS status refresh is paused. Click to resume.';
        } else {
            this.statusBarItem.text = '$(sync) SOS: Active';
            this.statusBarItem.tooltip = 'SOS status refresh is active. Click to pause.';
        }
    }
    
    updateFileAndAncestors(filePath: string): void {
        if (this.isPaused) {
            return;
        }
        
        // 防抖处理，避免频繁更新
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        this.debounceTimer = setTimeout(async () => {
            await this.doUpdateFileAndAncestors(filePath);
        }, this.debounceTimeout);
    }
    
    private async doUpdateFileAndAncestors(filePath: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
            if (!workspaceFolder) {
                return;
            }

            const foldersToUpdate: string[] = [];
            let currentPath = path.dirname(filePath);
            const workspaceRoot = workspaceFolder.uri.fsPath;

            // 对文件所在的直接父文件夹强制清除缓存，确保同级项状态最新
            const immediateParent = currentPath;
            this.folderStatusCache.delete(immediateParent);

            while (currentPath && currentPath.length >= workspaceRoot.length) {
                if (!path.basename(currentPath).startsWith('.')) {
                    foldersToUpdate.push(currentPath);
                }

                const parentPath = path.dirname(currentPath);

                if (parentPath === currentPath) {
                    break;
                }

                currentPath = parentPath;
            }

            // 确保 workspaceRoot 在列表中（去重）
            if (foldersToUpdate.indexOf(workspaceRoot) === -1) {
                foldersToUpdate.push(workspaceRoot);
            }

            if (isDebugEnabled()) {
                logDebug(`Updating ${foldersToUpdate.length} ancestor folders for: ${filePath}`);
            }

            // 逐层更新：每一层调用 updateFolderStatus，
            // getFolderStatus(folderPath) 执行 soscmd status folderPath/*
            // 会返回该文件夹下所有直接子项（文件和子文件夹）的状态，
            // 但不会递归进入子目录。这正好满足"更新同级项但不更新子目录内容"的需求。
            const chunkSize = Math.min(this.maxConcurrentUpdates, foldersToUpdate.length);

            for (let i = 0; i < foldersToUpdate.length; i += chunkSize) {
                const chunk = foldersToUpdate.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (folderPath) => {
                    await this.updateFolderStatus(folderPath);
                }));

                if (i + chunkSize < foldersToUpdate.length) {
                    await new Promise(resolve => setTimeout(resolve, BATCH_PROCESSING_DELAY));
                }
            }
        } catch (error) {
            if (isDebugEnabled()) {
                logError(`Failed to update file and ancestors: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    
    async updateFolderStatus(folderPath: string): Promise<void> {
        if (this.updatingFolders.has(folderPath)) {
            return;
        }
        
        // 检查缓存是否有效
        const cached = this.folderStatusCache.get(folderPath);
        const now = Date.now();
        
        if (cached && (now - cached.timestamp) < this.cacheExpiryTime) {
            if (isDebugEnabled()) {
                logDebug(`Using cached status for folder: ${folderPath}`);
            }
            
            // 使用缓存的状态
            const updatedPaths: string[] = [];
            cached.statusMap.forEach((status, filePath) => {
                const oldStatus = this.statusCache.get(filePath);
                if (!oldStatus || JSON.stringify(oldStatus) !== JSON.stringify(status)) {
                    this.statusCache.set(filePath, status);
                    updatedPaths.push(filePath);
                }
            });
            
            if (updatedPaths.length > 0) {
                const uris = updatedPaths
                    .map(filePath => {
                        try {
                            return vscode.Uri.file(filePath);
                        } catch {
                            return null;
                        }
                    })
                    .filter((uri): uri is vscode.Uri => uri !== null);
                
                if (uris.length > 0) {
                    this.decorationChangeEmitter.fire(uris);
                }
            }
            
            return;
        }
        
        this.updatingFolders.add(folderPath);
        
        try {
            const fs = require('fs');
            if (!fs.existsSync(folderPath) || !fs.lstatSync(folderPath).isDirectory()) {
                this.updatingFolders.delete(folderPath);
                return;
            }
            
            if (isDebugEnabled()) {
                logDebug(`Getting status for folder: ${folderPath}`);
            }
            
            const statusMap = await getFolderStatus(folderPath);
            
            // 更新缓存
            this.folderStatusCache.set(folderPath, {
                statusMap,
                timestamp: now
            });
            
            if (isDebugEnabled()) {
                logDebug(`Got ${statusMap.size} status entries from soscmd and cached`);
            }
            
            const updatedPaths: string[] = [];
            statusMap.forEach((status, filePath) => {
                const oldStatus = this.statusCache.get(filePath);
                if (!oldStatus || JSON.stringify(oldStatus) !== JSON.stringify(status)) {
                    this.statusCache.set(filePath, status);
                    updatedPaths.push(filePath);
                }
            });
            
            if (updatedPaths.length > 0) {
                const uris = updatedPaths
                    .map(filePath => {
                        try {
                            return vscode.Uri.file(filePath);
                        } catch {
                            return null;
                        }
                    })
                    .filter((uri): uri is vscode.Uri => uri !== null);
                
                if (uris.length > 0) {
                    this.decorationChangeEmitter.fire(uris);
                    this._onDidUpdateStatus.fire();
                }
            }
        } catch (error) {
            if (isDebugEnabled()) {
                logError(`Failed to update folder status for ${folderPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            this.updatingFolders.delete(folderPath);
        }
    }

    clearCache(): void {
        this.statusCache.clear();
        this.folderStatusCache.clear();
        this._onDidUpdateStatus.fire();
    }
    
    clearFolderCache(folderPath: string): void {
        this.folderStatusCache.delete(folderPath);
        // 也清除该文件夹下所有文件的状态缓存
        for (const filePath of this.statusCache.keys()) {
            if (filePath.startsWith(folderPath)) {
                this.statusCache.delete(filePath);
            }
        }
    }
    
    dispose(): void {
        if (this.periodicUpdateTimer) {
            clearInterval(this.periodicUpdateTimer);
            this.periodicUpdateTimer = undefined;
        }
        
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        
        this.decorationChangeEmitter.dispose();
        this._onDidUpdateStatus.dispose();
        
        this.statusCache.clear();
        this.folderStatusCache.clear();
        this.updatingFolders.clear();
        
        if (this.fileDecorationProviderRegistration) {
            this.fileDecorationProviderRegistration.dispose();
            this.fileDecorationProviderRegistration = undefined;
        }
        
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
        }
    }
}

let fileStatusDecorator: FileStatusDecorator;