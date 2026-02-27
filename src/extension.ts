import * as vscode from 'vscode';
import * as path from 'path';
import { FileStatus, getFolderStatus, getFileVersions, switchFileVersion, executeSoscmd, FileVersion, getFileStatus } from './soscmd';
import { isDebugEnabled, logDebug, logError, isCommandEnabled, getCommandConfig, replaceCommandVariables, BATCH_SIZE } from './utils';

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

    if (filePaths.length <= BATCH_SIZE) {
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
    } else {
        const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);
        logDebug(`${commandName}: Processing ${filePaths.length} files in ${totalBatches} batches`);
        
        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
            const batch = filePaths.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const command = buildCommand(batch);
            
            logDebug(`${commandName} batch ${batchNum}/${totalBatches}:`, command);
            
            try {
                await executeSoscmd(command, fileDir);
                results.successCount += batch.length;
                vscode.window.showInformationMessage(`${commandName} batch ${batchNum}/${totalBatches} completed`);
            } catch (error) {
                results.failCount += batch.length;
                results.errors.push(error);
                vscode.window.showErrorMessage(`${commandName} batch ${batchNum}/${totalBatches} failed: ${error}`);
            }
        }
    }
    return results;
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
                await switchFileVersion(filePath, version.id);
                
                if (isDebugEnabled()) {
                    logDebug(`Re-fetching file status after version switch`);
                }
                
                await treeDataProvider.setFile(filePath);
                
                if (isDebugEnabled()) {
                    logDebug(`Refreshing tree after version switch`);
                }

                // ... 参数校验和切换逻辑
                await switchFileVersion(filePath, version.id);
                
                // 清除该文件所在文件夹的缓存
                const folder = path.dirname(filePath);
                fileStatusDecorator.clearFolderCache(folder);
                
                // 更新文件及其祖先
                await treeDataProvider.setFile(filePath);
                fileStatusDecorator.updateFileAndAncestors(filePath);

            } else {
                logError(`Invalid parameters for switchVersion: filePath=${filePath}, version=${version}`);
            }
        })
    );
    if (isDebugEnabled()) {
        logDebug('Switch version command registered');
    }

    // 全局变量用于处理多文件选择
    let pendingMultiFileCommands: { [key: string]: { filePaths: string[], timer: NodeJS.Timeout } } = {};
    
    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkout', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            logDebug('Checkout command called with uri:', uri);
            logDebug('Checkout command called with uris:', uris);
            if (!isCommandEnabled('checkout')) {
                logDebug('Checkout command is disabled');
                return;
            }
            
            const targetUris = uris || [uri];
            logDebug('Target uris:', targetUris);
            
            const filePaths = targetUris.map(u => u.fsPath);
            logDebug('File paths collected:', filePaths);
            
            if (filePaths.length === 0) {
                logDebug('No file paths to process');
                return;
            }
            
            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(function(p) { return path.basename(p); }).join(', ');
            
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
                        return replaceCommandVariables(command, { filePath: batch.map(p => `"${p}"`).join(' ') });
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
        vscode.commands.registerCommand('cliosoft-sos-manager.checkin', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            logDebug('Checkin command called with uri:', uri);
            logDebug('Checkin command called with uris:', uris);
            if (!isCommandEnabled('checkin')) {
                logDebug('Checkin command is disabled');
                return;
            }
            
            const targetUris = uris || [uri];
            logDebug('Target uris:', targetUris);
            
            const filePaths = targetUris.map(u => u.fsPath);
            logDebug('File paths collected:', filePaths);
            
            if (filePaths.length === 0) {
                logDebug('No file paths to process');
                return;
            }
            
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
            const fileNames = filePaths.map(function(p) { return path.basename(p); }).join(', ');
            
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
                        return replaceCommandVariables(command, { filePath: batch.map(p => `"${p}"`).join(' '), comments });
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
        vscode.commands.registerCommand('cliosoft-sos-manager.diff', async (uri: vscode.Uri) => {
            if (!isCommandEnabled('diff')) {
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
            const fileName = path.basename(filePath);
            
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
        vscode.commands.registerCommand('cliosoft-sos-manager.discard', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            logDebug('Discard command called with uri:', uri);
            logDebug('Discard command called with uris:', uris);
            if (!isCommandEnabled('discard')) {
                logDebug('Discard command is disabled');
                return;
            }
            
            const targetUris = uris || [uri];
            logDebug('Target uris:', targetUris);
            
            const filePaths = targetUris.map(u => u.fsPath);
            logDebug('File paths collected:', filePaths);
            
            if (filePaths.length === 0) {
                logDebug('No file paths to process');
                return;
            }
            
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
            const fileNames = filePaths.map(function(p) { return path.basename(p); }).join(', ');
            
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
                        return replaceCommandVariables(command, { filePath: batch.map(p => `"${p}"`).join(' '), useForce: useForce ? '-F' : '' });
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
            
            let command = getCommandConfig('officeOpen');
            if (!command) {
                command = `soffice "${filePath}"`;
            }
            
            command = replaceCommandVariables(command, { filePath });
            await executeSoscmd(command, fileDir);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.rebuildCtags', async (uri: vscode.Uri) => {
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
            
            let command = getCommandConfig('rebuildCtags');
            if (!command) {
                command = `cd "\${env:PROJ_ROOT}" ; ctags -R --fields=+nKz -f .vscode/.tags --langmap=SystemVerilog:+.v+.sv -R --links=yes ./design_data/rtl ./design_data/testbench ./ref_ip`;
            }
            
            command = replaceCommandVariables(command, { filePath });
            await executeSoscmd(command, fileDir);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.toggleRefresh', () => {
            fileStatusDecorator.toggleRefresh();
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
                    
                    if ((activeTab.input as any).uri) {
                        filePath = (activeTab.input as any).uri.fsPath;
                    }
                    else if ((activeTab.input as any).viewType) {
                        const input = activeTab.input as any;
                        if (input.uri) {
                            filePath = input.uri.fsPath;
                        }
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
                        
                        if ((activeTab.input as any).uri) {
                            filePath = (activeTab.input as any).uri.fsPath;
                        }
                        else if ((activeTab.input as any).viewType) {
                            const input = activeTab.input as any;
                            if (input.uri) {
                                filePath = input.uri.fsPath;
                            }
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
        }, 500);
        
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
    }, 5000);
    
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
    private readonly maxConcurrentUpdates = 5;
    private readonly decorationChangeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    private fileDecorationProvider: vscode.FileDecorationProvider;
    private fileDecorationProviderRegistration: vscode.Disposable | undefined;
    private isPaused: boolean = false;
    private statusBarItem: vscode.StatusBarItem;
    private readonly cacheExpiryTime = 30000; // 30秒缓存过期时间
    private readonly debounceTimeout = 500; // 500毫秒防抖
    private debounceTimer: NodeJS.Timeout | undefined;
    
    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem('cliosoft-sos-manager.refreshToggle', vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = '$(sync~spin) Refreshing...';
        this.statusBarItem.command = 'cliosoft-sos-manager.toggleRefresh';
        this.statusBarItem.tooltip = 'Click to pause/resume status refresh';
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
    
    toggleRefresh(): void {
        this.isPaused = !this.isPaused;
        
        if (this.isPaused) {
            this.statusBarItem.text = '$(debug-pause) Paused';
            this.statusBarItem.tooltip = 'Status refresh is paused. Click to resume.';
        } else {
            this.statusBarItem.text = '$(sync~spin) Refreshing...';
            this.statusBarItem.tooltip = 'Status refresh is active. Click to pause.';
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
            
            foldersToUpdate.push(workspaceRoot);
            
            if (isDebugEnabled()) {
                logDebug(`Updating ${foldersToUpdate.length} ancestor folders: ${foldersToUpdate.join(', ')}`);
            }
            
            const chunkSize = Math.min(this.maxConcurrentUpdates, foldersToUpdate.length);
            
            for (let i = 0; i < foldersToUpdate.length; i += chunkSize) {
                const chunk = foldersToUpdate.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (folderPath) => {
                    await this.updateFolderStatus(folderPath);
                }));
                
                if (i + chunkSize < foldersToUpdate.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
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