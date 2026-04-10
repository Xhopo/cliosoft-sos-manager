import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { FileStatus, getFolderStatus, getFileVersions, switchFileVersion, executeSoscmd, FileVersion, getFileStatus, getInterestingStatus } from './soscmd';
import { isDebugEnabled, logDebug, logError, isCommandEnabled, getCommandConfig, replaceCommandVariables, BATCH_SIZE, isPlatformSupported, showPlatformWarning, outputChannel, getConfig, showSosError } from './utils';
import { FilteredStatusTreeDataProvider, isFileInteresting } from './filteredStatusTree';

const execAsync = promisify(exec);

// Configuration helpers — read from settings with fallback defaults
function getCacheExpiryTime(): number {
    return (getConfig().get<number>('cacheExpiryTime', 180)) * 1000;
}
function getStatusRefreshInterval(): number {
    return (getConfig().get<number>('statusRefreshInterval', 30)) * 1000;
}
function isDiskCacheEnabled(): boolean {
    return getConfig().get<boolean>('enableDiskCache', true);
}

const DEBOUNCE_TIMEOUT = 200;
const TAB_POLLING_INTERVAL = 1000;

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
                fileStatusDecorator.updateFileStatus(filePath);
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
    buildArgs: (batch: string[]) => string | string[],
    commandName: string
): Promise<{ successCount: number; failCount: number; errors: any[] }> {
    const results = { successCount: 0, failCount: 0, errors: [] as any[] };

    // Show progress notification for batch operations
    if (filePaths.length > 1) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `${commandName} ${filePaths.length} files...`,
            cancellable: true
        }, async (progress, token) => {
            return executeBatchCommandWithProgress(filePaths, fileDir, buildArgs, commandName, results, progress, token);
        });
    } else {
        // Single file operation without progress
        const cmdOrArgs = buildArgs(filePaths);
        logDebug(`${commandName} command:`, Array.isArray(cmdOrArgs) ? cmdOrArgs.join(' ') : cmdOrArgs);
        try {
            await executeSoscmd(cmdOrArgs as any, fileDir);
            results.successCount = filePaths.length;
        } catch (error) {
            results.failCount = filePaths.length;
            results.errors.push(error);
            vscode.window.showErrorMessage(`${commandName} failed: ${error}`, 'Show Output').then(choice => {
                if (choice === 'Show Output') { outputChannel.show(); }
            });
        }
    }

    return results;
}

async function executeBatchCommandWithProgress(
    filePaths: string[],
    fileDir: string,
    buildArgs: (batch: string[]) => string | string[],
    commandName: string,
    results: { successCount: number; failCount: number; errors: any[] },
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<void> {
    const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);
    logDebug(`${commandName}: Processing ${filePaths.length} files in ${totalBatches} batches`);

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        if (token.isCancellationRequested) {
            logDebug(`${commandName}: Cancelled by user after ${results.successCount} successes`);
            break;
        }

        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const cmdOrArgs = buildArgs(batch);

        logDebug(`${commandName} batch ${batchNum}/${totalBatches}:`, Array.isArray(cmdOrArgs) ? cmdOrArgs.join(' ') : cmdOrArgs);

        progress.report({
            message: `Processing batch ${batchNum}/${totalBatches}`,
            increment: (100 / totalBatches)
        });

        try {
            await executeSoscmd(cmdOrArgs as any, fileDir);
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
            }

            if (filePath && version) {
                if (isDebugEnabled()) {
                    logDebug(`Calling switchFileVersion for ${filePath} with version ${version.id}`);
                }

                // 执行版本切换，返回是否成功
                const success = await switchFileVersion(filePath, version.id);

                if (success) {
                    // 清除该文件所在文件夹的缓存
                    const folder = path.dirname(filePath);
                    fileStatusDecorator.clearFolderCache(folder);

                    // 重新加载文件内容，消除标签页"未保存"标记
                    await revertFileInEditor(filePath);

                    // 更新文件及其祖先
                    await treeDataProvider.setFile(filePath);
                    fileStatusDecorator.updateFileStatus(filePath);

                    if (isDebugEnabled()) {
                        logDebug(`Version switch completed and UI refreshed`);
                    }
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
                    const customCmd = getCommandConfig('checkout');
                    if (!customCmd) {
                        return ['co', '-Nlock', ...batch];
                    } else {
                        return replaceCommandVariables(customCmd, { filePath: batch });
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
                    const customCmd = getCommandConfig('checkin');
                    if (!customCmd) {
                        return ['ci', `-aLog=${comments}`, ...batch];
                    } else {
                        return replaceCommandVariables(customCmd, { filePath: batch, comments });
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
                    const customCmd = getCommandConfig('discard');
                    if (!customCmd) {
                        return useForce ? ['discard', '-F', ...batch] : ['discard', ...batch];
                    } else {
                        return replaceCommandVariables(customCmd, { filePath: batch, useForce: useForce ? '-F' : '' });
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
                showSosError(errorMsg);
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
                showSosError(errorMsg);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.toggleRefresh', () => {
            fileStatusDecorator.toggleRefresh();
        })
    );

    // Quick commands for active editor file (keybinding targets)
    const NO_EDITOR_HINT = 'Shortcut not available for this file type. Please use the right-click context menu in Explorer instead.';

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.quickCheckout', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(NO_EDITOR_HINT);
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
                vscode.window.showWarningMessage(NO_EDITOR_HINT);
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
                vscode.window.showWarningMessage(NO_EDITOR_HINT);
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

    // 设置磁盘缓存路径并尝试加载
    let hasDiskCache = false;
    if (isDiskCacheEnabled()) {
        const diskCachePath = path.join(context.globalStorageUri.fsPath, 'statusCache.json');
        fileStatusDecorator.setDiskCachePath(diskCachePath);
        hasDiskCache = fileStatusDecorator.loadDiskCache();
    }

    // 初始化刷新（仅限磁盘文件）
    vscode.workspace.textDocuments.forEach(doc => {
        if (doc.uri.scheme !== 'file') { return; }
        const filePath = doc.uri.fsPath;
        if (filePath) {
            fileStatusDecorator.updateFileStatus(filePath);
        }
    });
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
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
        fileStatusDecorator.setFilteredTreeProvider(filteredTreeProvider);

        const filteredTreeView = vscode.window.createTreeView(
            'cliosoft-sos-manager.filteredStatus',
            { treeDataProvider: filteredTreeProvider, showCollapseAll: true, canSelectMany: true }
        );
        context.subscriptions.push(filteredTreeView);

        // 状态缓存更新时重建过滤树，并刷新文件夹 decoration
        context.subscriptions.push(
            fileStatusDecorator.onDidUpdateStatus(() => {
                filteredTreeProvider!.rebuild();
                // rebuild 后 interesting 文件集合变了，文件夹 badge 数字需要更新
                fileStatusDecorator.fireDecorationChange();
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

        // 显示调试输出通道命令
        context.subscriptions.push(
            vscode.commands.registerCommand('cliosoft-sos-manager.showOutputChannel', () => {
                outputChannel.show();
            })
        );

        // 视图首次可见时：有磁盘缓存则跳过全量扫描，否则触发扫描
        context.subscriptions.push(
            filteredTreeView.onDidChangeVisibility(e => {
                if (e.visible && filteredTreeProvider!.isEmpty() && !hasDiskCache) {
                    vscode.commands.executeCommand('cliosoft-sos-manager.refreshFilteredStatus');
                }
            })
        );
    }

    // 注：onDidChangeActiveTextEditor 已在下方 tabChangeListener 中统一处理（含去重），此处不再重复注册
    
    // 监听文件打开事件（仅限磁盘文件，排除 Output Channel 等虚拟文档）
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.uri.scheme !== 'file') { return; }
            fileStatusDecorator.updateFileStatus(document.uri.fsPath);
        })
    );
    
    // 监听资源管理器中的文件选择变化（包括非文本文件如.xlsx）
    // 使用VSCode的Tab Groups API来监听所有类型的标签页变化
    let lastActiveTab: string | undefined;
    
    // 监听标签页变化事件（仅限磁盘文件）
    const tabChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document && editor.document.uri.scheme === 'file') {
            const currentFile = editor.document.uri.fsPath;
            if (currentFile !== lastActiveTab) {
                lastActiveTab = currentFile;
                fileStatusDecorator.updateFileStatus(currentFile);
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
                    if (input.uri && input.uri.scheme === 'file') {
                        filePath = input.uri.fsPath;
                    }

                    if (filePath && filePath !== lastActiveTab) {
                        lastActiveTab = filePath;
                        fileStatusDecorator.updateFileStatus(filePath);
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
                        if (input.uri && input.uri.scheme === 'file') {
                            filePath = input.uri.fsPath;
                        }

                        if (filePath && filePath !== lastActiveTab) {
                            lastActiveTab = filePath;
                            fileStatusDecorator.updateFileStatus(filePath);
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
        if (activeEditor && activeEditor.document && activeEditor.document.uri.scheme === 'file') {
            fileStatusDecorator.updateFileStatus(activeEditor.document.uri.fsPath);
        }
    }, getStatusRefreshInterval());
    
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            fileStatusDecorator.clearCache();
        })
    );
    
    // onDidChangeTextDocument 已移除：每次编辑都触发 soscmd 毫无意义，
    // SOS 状态只在 save/co/ci 时才会变化，由 onDidSaveTextDocument 覆盖。
    
    // 添加文件保存监听器（仅限磁盘文件）
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.uri.scheme !== 'file') { return; }
            const filePath = document.uri.fsPath;
            if (isDebugEnabled()) {
                logDebug(`File saved: ${filePath}`);
            }
            // 清除该文件所在文件夹的缓存
            if (fileStatusDecorator) {
                const folderPath = path.dirname(filePath);
                fileStatusDecorator.clearFolderCache(folderPath);
                // 更新文件状态
                fileStatusDecorator.updateFileStatus(filePath);
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
    private pendingFolderUpdates: Map<string, Promise<void>> = new Map();
    private readonly decorationChangeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    private readonly _onDidUpdateStatus = new vscode.EventEmitter<void>();
    readonly onDidUpdateStatus: vscode.Event<void> = this._onDidUpdateStatus.event;
    private fileDecorationProvider: vscode.FileDecorationProvider;
    private fileDecorationProviderRegistration: vscode.Disposable | undefined;
    private isPaused: boolean = false;
    private statusBarItem: vscode.StatusBarItem;
    private readonly cacheExpiryTime = getCacheExpiryTime();
    private readonly debounceTimeout = DEBOUNCE_TIMEOUT;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private diskCachePath: string | undefined;
    private filteredTreeProvider: FilteredStatusTreeDataProvider | undefined;

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
                    // 没有文件级缓存，检查是否是文件夹且子目录有 interesting 文件
                    if (this.filteredTreeProvider) {
                        const count = this.filteredTreeProvider.getInterestingFileCount(filePath);
                        if (count > 0) {
                            const badgeText = count > 9 ? '9+' : String(count);
                            return {
                                badge: badgeText,
                                color: new vscode.ThemeColor('gitDecoration.conflictingResourceForeground'),
                                tooltip: `${count} changed file(s) inside`
                            };
                        }
                    }
                    return undefined;
                }

                // 文件级 badge
                let badge = '';
                let color: vscode.ThemeColor | undefined;
                const tooltipParts: string[] = [];

                if (status.state === 'O' || status.state === 'W') {
                    tooltipParts.push('Checked Out');
                    if (status.change === 'M') {
                        badge = 'M';
                        color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
                        tooltipParts.push('Modified');
                    } else {
                        badge = 'CO';
                        color = new vscode.ThemeColor('gitDecoration.addedResourceForeground');
                    }
                } else if (status.change === 'M') {
                    badge = 'M';
                    color = new vscode.ThemeColor('gitDecoration.stageModifiedResourceForeground');
                    tooltipParts.push('Modified (not checked out)');
                } else if (status.change === '!') {
                    badge = 'D';
                    color = new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
                    tooltipParts.push('Deleted');
                }

                if (status.newRevision === 'N') {
                    badge = badge ? badge[0] + '!' : 'N!';
                    color = new vscode.ThemeColor('gitDecoration.conflictingResourceForeground');
                    tooltipParts.push('Has New Revision');
                }

                // 兜底：SOS 管理的文件如果没有特殊状态，显示 Checked In
                if (!badge && status.state === '-') {
                    badge = 'CI';
                    color = new vscode.ThemeColor('gitDecoration.untrackedResourceForeground');
                    tooltipParts.push('Checked In');
                }

                if (badge) {
                    return {
                        badge,
                        color,
                        tooltip: tooltipParts.join(', ')
                    };
                }

                return undefined;
            },
            onDidChangeFileDecorations: this.decorationChangeEmitter.event
        };
        
        this.fileDecorationProviderRegistration = vscode.window.registerFileDecorationProvider(this.fileDecorationProvider);
    }

    /**
     * 设置 FilteredStatusTreeDataProvider 引用，用于文件夹 badge 聚合
     */
    setFilteredTreeProvider(provider: FilteredStatusTreeDataProvider): void {
        this.filteredTreeProvider = provider;
    }

    /**
     * 触发全量 decoration 刷新（用于 rebuild 后更新文件夹 badge）
     */
    fireDecorationChange(): void {
        this.decorationChangeEmitter.fire(undefined);
    }

    /**
     * 暴露 statusCache 供 FilteredStatusTreeDataProvider 读取
     */
    get fileStatusCache(): Map<string, FileStatus> {
        return this.statusCache;
    }

    /**
     * 全量扫描工作区，填充 statusCache。
     * 使用 soscmd select 参数一次性获取所有 interesting 文件，替代逐文件夹递归。
     */
    async performFullWorkspaceScan(
        workspaceRoot: string,
        progress?: vscode.Progress<{ message?: string }>,
        cancellationToken?: vscode.CancellationToken
    ): Promise<void> {
        progress?.report({ message: 'Querying SOS for changed files...' });

        const statusMap = await getInterestingStatus(workspaceRoot, cancellationToken);

        if (cancellationToken?.isCancellationRequested) { return; }

        // 全量刷新：清除 folderStatusCache 使后续按需查询走实时路径
        this.folderStatusCache.clear();

        // 从 statusCache 中移除之前 CO 但现在不再 CO 的条目
        for (const [filePath, oldStatus] of this.statusCache) {
            if (isFileInteresting(oldStatus) && !statusMap.has(filePath)) {
                this.statusCache.delete(filePath);
            }
        }

        // 写入/更新本次 CO 文件的状态
        statusMap.forEach((status, filePath) => {
            this.statusCache.set(filePath, status);
        });

        logDebug(`performFullWorkspaceScan: ${statusMap.size} checked-out files, statusCache: ${this.statusCache.size}`);

        progress?.report({ message: `Found ${statusMap.size} changed files` });

        // 扫描完成后通知装饰器刷新 + 通知过滤树重建
        this.decorationChangeEmitter.fire(undefined);
        this._onDidUpdateStatus.fire();
        // 持久化到磁盘
        this.saveDiskCache();
    }

    /**
     * 设置磁盘缓存文件路径（由 activate 传入 globalStoragePath）
     */
    setDiskCachePath(cachePath: string): void {
        this.diskCachePath = cachePath;
    }

    /**
     * 从磁盘加载上次扫描的 statusCache，立即填充内存并触发 UI 刷新。
     * 返回是否成功加载了缓存。
     */
    loadDiskCache(): boolean {
        if (!this.diskCachePath) { return false; }
        try {
            if (!fs.existsSync(this.diskCachePath)) { return false; }
            const raw = fs.readFileSync(this.diskCachePath, 'utf-8');
            const data: { timestamp: number; entries: [string, FileStatus][] } = JSON.parse(raw);
            if (!Array.isArray(data.entries) || data.entries.length === 0) { return false; }

            // 超过 24 小时的缓存视为过期
            const DISK_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
            if (data.timestamp && (Date.now() - data.timestamp) > DISK_CACHE_MAX_AGE) {
                logDebug(`Disk cache expired (saved ${new Date(data.timestamp).toLocaleString()}), skipping`);
                return false;
            }

            for (const [filePath, status] of data.entries) {
                this.statusCache.set(filePath, status);
            }
            this.decorationChangeEmitter.fire(undefined);
            this._onDidUpdateStatus.fire();
            logDebug(`Loaded ${data.entries.length} cached status entries from disk (saved ${new Date(data.timestamp).toLocaleString()})`);
            return true;
        } catch (e) {
            logDebug(`Failed to load disk cache: ${e}`);
            return false;
        }
    }

    /**
     * 将当前 statusCache 写入磁盘
     */
    private saveDiskCache(): void {
        if (!this.diskCachePath) { return; }
        try {
            const dir = path.dirname(this.diskCachePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = {
                timestamp: Date.now(),
                entries: Array.from(this.statusCache.entries())
            };
            fs.writeFileSync(this.diskCachePath, JSON.stringify(data), 'utf-8');
            logDebug(`Saved ${data.entries.length} status entries to disk cache`);
        } catch (e) {
            logDebug(`Failed to save disk cache: ${e}`);
        }
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
    
    updateFileStatus(filePath: string): void {
        if (this.isPaused) {
            return;
        }
        
        // per-file 防抖：快速切换 A→B→C 时，每个文件都能得到更新
        const folderPath = path.dirname(filePath);
        const existing = this.debounceTimers.get(folderPath);
        if (existing) {
            clearTimeout(existing);
        }

        this.debounceTimers.set(folderPath, setTimeout(async () => {
            this.debounceTimers.delete(folderPath);
            await this.doUpdateFileAndAncestors(filePath);
        }, this.debounceTimeout));
    }
    
    private async doUpdateFileAndAncestors(filePath: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
            if (!workspaceFolder) {
                return;
            }

            // 只更新文件所在的直接父文件夹，不再遍历所有祖先
            // 祖先文件夹的状态由全量扫描和缓存覆盖
            const folderPath = path.dirname(filePath);
            this.folderStatusCache.delete(folderPath);

            if (isDebugEnabled()) {
                logDebug(`Updating folder status for: ${folderPath}`);
            }

            await this.updateFolderStatus(folderPath);
        } catch (error) {
            if (isDebugEnabled()) {
                logError(`Failed to update file status: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    
    async updateFolderStatus(folderPath: string): Promise<void> {
        // 如果已经有正在进行的更新，直接返回该 Promise
        if (this.pendingFolderUpdates.has(folderPath)) {
            return this.pendingFolderUpdates.get(folderPath)!;
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
                this._onDidUpdateStatus.fire();
            }
            
            // 缓存命中时返回已解决的 Promise
            return Promise.resolve();
        }

        const updatePromise = this.doUpdateFolderStatus(folderPath);
        this.pendingFolderUpdates.set(folderPath, updatePromise);

        try {
            await updatePromise;
        } finally {
            this.pendingFolderUpdates.delete(folderPath);
        }
    }

    private async doUpdateFolderStatus(folderPath: string): Promise<void> {
        try {
            if (!fs.existsSync(folderPath) || !fs.lstatSync(folderPath).isDirectory()) {
                return;
            }
            
            if (isDebugEnabled()) {
                logDebug(`Getting status for folder: ${folderPath}`);
            }
            
            const statusMap = await getFolderStatus(folderPath);
            const now = Date.now();
            
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

            if (isDebugEnabled()) {
                logDebug(`Updated ${updatedPaths.length} paths, statusCache size: ${this.statusCache.size}`);
            }
            
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
            throw error;
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
        const prefix = folderPath + path.sep;
        for (const filePath of this.statusCache.keys()) {
            if (filePath.startsWith(prefix) || filePath === folderPath) {
                this.statusCache.delete(filePath);
            }
        }
    }
    
    dispose(): void {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        
        this.decorationChangeEmitter.dispose();
        this._onDidUpdateStatus.dispose();
        
        this.statusCache.clear();
        this.folderStatusCache.clear();
        this.pendingFolderUpdates.clear();
        
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