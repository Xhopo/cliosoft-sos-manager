import * as vscode from 'vscode';
import * as path from 'path';
import { FileStatus, getFolderStatus, getFileVersions, switchFileVersion, executeSoscmd, FileVersion, getFileStatus } from './soscmd';
import { isDebugEnabled } from './utils';

// 获取配置
function getConfig() {
    return vscode.workspace.getConfiguration('cliosoft-sos-manager');
}

// 检查命令是否启用
function isCommandEnabled(commandName: string): boolean {
    const config = getConfig();
    return config.get(`commands.${commandName}.enable`, true);
}

// 获取命令配置
function getCommandConfig(commandName: string): string {
    const config = getConfig();
    return config.get(`commands.${commandName}.command`, '');
}

// 替换命令中的变量
function replaceCommandVariables(command: string, variables: Record<string, string>): string {
    let result = command;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\$\{${key}\}`, 'g'), value);
    }
    return result;
}

// 刷新文件状态，确保VSCode与SOS状态一致
async function refreshFileStatus(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
        const fileUri = vscode.Uri.file(filePath);
        try {
            // 1. 首先，确保文件存在
            await vscode.workspace.fs.stat(fileUri);
            
            // 2. 查找对应的编辑器
            const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === filePath);
            if (editor) {
                // 3. 关闭当前编辑器
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                console.log(`[DEBUG] Closed editor for ${filePath}`);
                
                // 4. 重新打开文件
                const document = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(document, {
                    viewColumn: editor.viewColumn,
                    preserveFocus: true,
                    preview: false
                });
                console.log(`[DEBUG] Reopened file ${filePath}`);
            }
            
            // 5. 刷新文件浏览器
            await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            
            // 6. 触发文件系统事件
            await vscode.workspace.fs.stat(fileUri);
            
            console.log(`[DEBUG] Completed file status refresh for ${filePath}`);
        } catch (error) {
            console.error(`[ERROR] Failed to refresh file status for ${filePath}:`, error);
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
            this.description = `${version.changeSummary}`
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
            console.log(`[DEBUG] File set to: ${filePath}`);
            console.log(`[DEBUG] File status: ${JSON.stringify(this.currentFileStatus)}`);
        }
        
        this.refresh();
    }

    getTreeItem(element: FileVersionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileVersionItem): Promise<FileVersionItem[]> {
        if (isDebugEnabled()) {
            console.log(`[DEBUG] getChildren called with element: ${element?.label}`);
        }
        
        if (!element) {
            if (!this.currentFilePath) {
                if (isDebugEnabled()) {
                    console.log('[DEBUG] No file selected, returning noVersions item');
                }
                return [new FileVersionItem(null, null, false)];
            }

            if (isDebugEnabled()) {
                console.log(`[DEBUG] Active file: ${this.currentFilePath}`);
            }
            
            const versions = await getFileVersions(this.currentFilePath);
            if (isDebugEnabled()) {
                console.log(`[DEBUG] getFileVersions returned ${versions.length} versions`);
            }

            if (versions.length === 0) {
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] No versions found, returning noVersions item`);
                }
                return [new FileVersionItem(null, this.currentFilePath, false)];
            }

            if (isDebugEnabled()) {
                console.log(`[DEBUG] Creating FileVersionItems for ${versions.length} versions`);
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
        console.log('[DEBUG] ClioSoft SOS Manager extension activating...');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activating...');
    }
    
    const treeDataProvider = new FileVersionsTreeDataProvider();
    if (isDebugEnabled()) {
        console.log('[DEBUG] Tree data provider created');
    }

    vscode.window.registerTreeDataProvider('cliosoft-sos-manager.fileVersions', treeDataProvider);
    if (isDebugEnabled()) {
        console.log('[DEBUG] Tree view provider registered');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.refreshVersions', () => {
            if (isDebugEnabled()) {
                console.log('[DEBUG] Refresh versions command executed');
                vscode.window.showInformationMessage('[DEBUG] Refresh versions command executed');
            }
            treeDataProvider.refresh();
        })
    );
    if (isDebugEnabled()) {
        console.log('[DEBUG] Refresh command registered');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.switchVersion', async (filePath: string | null, version: FileVersion | null) => {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Switch version command executed with filePath: ${filePath}, version: ${version?.id}`);
                vscode.window.showInformationMessage(`[DEBUG] Switch version command: ${filePath} -> v${version?.id}`);
            }
            
            if (filePath && version) {
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Calling switchFileVersion for ${filePath} with version ${version.id}`);
                }
                await switchFileVersion(filePath, version.id);
                
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Re-fetching file status after version switch`);
                }
                
                await treeDataProvider.setFile(filePath);
                
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Refreshing tree after version switch`);
                }
            } else {
                console.error(`[ERROR] Invalid parameters for switchVersion: filePath=${filePath}, version=${version}`);
            }
        })
    );
    if (isDebugEnabled()) {
        console.log('[DEBUG] Switch version command registered');
    }

    // 全局变量用于处理多文件选择
    let pendingMultiFileCommands: { [key: string]: { filePaths: string[], timer: NodeJS.Timeout } } = {};
    
    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkout', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            console.log('[DEBUG] Checkout command called with uri:', uri);
            console.log('[DEBUG] Checkout command called with uris:', uris);
            if (!isCommandEnabled('checkout')) {
                console.log('[DEBUG] Checkout command is disabled');
                return;
            }
            
            // 处理多文件选择：如果提供了uris参数，则使用它，否则使用单个uri
            const targetUris = uris || [uri];
            console.log('[DEBUG] Target uris:', targetUris);
            
            const filePaths = targetUris.map(u => u.fsPath);
            console.log('[DEBUG] File paths collected:', filePaths);
            
            if (filePaths.length === 0) {
                console.log('[DEBUG] No file paths to process');
                return;
            }
            
            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(function(p) { return path.basename(p); }).join(', ');
            
            console.log('[DEBUG] Working directory:', fileDir);
            console.log('[DEBUG] File names:', fileNames);
            
            let command = getCommandConfig('checkout');
            if (!command) {
                command = 'soscmd co -Nlock ' + filePaths.join(' ');
            } else {
                command = replaceCommandVariables(command, { filePath: filePaths.join(' ') });
            }
            
            console.log('[DEBUG] Final command to execute:', command);
            
            await executeSoscmd(command, fileDir);
            vscode.window.showInformationMessage('Checked out: ' + fileNames);
            console.log('[DEBUG] Checkout command completed successfully');
            
            // 刷新文件状态，确保VSCode与SOS状态一致
            await refreshFileStatus(filePaths);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkin', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            console.log('[DEBUG] Checkin command called with uri:', uri);
            console.log('[DEBUG] Checkin command called with uris:', uris);
            if (!isCommandEnabled('checkin')) {
                console.log('[DEBUG] Checkin command is disabled');
                return;
            }
            
            // 处理多文件选择：如果提供了uris参数，则使用它，否则使用单个uri
            const targetUris = uris || [uri];
            console.log('[DEBUG] Target uris:', targetUris);
            
            const filePaths = targetUris.map(u => u.fsPath);
            console.log('[DEBUG] File paths collected:', filePaths);
            
            if (filePaths.length === 0) {
                console.log('[DEBUG] No file paths to process');
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
            
            console.log('[DEBUG] Working directory:', fileDir);
            console.log('[DEBUG] File names:', fileNames);
            
            let command = getCommandConfig('checkin');
            if (!command) {
                command = 'soscmd ci -aLog="' + comments + '" ' + filePaths.join(' ');
            } else {
                command = replaceCommandVariables(command, { filePath: filePaths.join(' '), comments });
            }
            
            console.log('[DEBUG] Final command to execute:', command);
            
            await executeSoscmd(command, fileDir);
            vscode.window.showInformationMessage('Checked in: ' + fileNames);
            console.log('[DEBUG] Checkin command completed successfully');
            
            // 刷新文件状态，确保VSCode与SOS状态一致
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
                console.log(`[DEBUG] Diff command executed for: ${filePath}`);
            }
            
            let command = getCommandConfig('diff');
            if (!command) {
                command = `soscmd diff -gui ${filePath}`;
            }
            
            command = replaceCommandVariables(command, { filePath });
            await executeSoscmd(command, fileDir);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.discard', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            console.log('[DEBUG] Discard command called with uri:', uri);
            console.log('[DEBUG] Discard command called with uris:', uris);
            if (!isCommandEnabled('discard')) {
                console.log('[DEBUG] Discard command is disabled');
                return;
            }
            
            // 处理多文件选择：如果提供了uris参数，则使用它，否则使用单个uri
            const targetUris = uris || [uri];
            console.log('[DEBUG] Target uris:', targetUris);
            
            const filePaths = targetUris.map(u => u.fsPath);
            console.log('[DEBUG] File paths collected:', filePaths);
            
            if (filePaths.length === 0) {
                console.log('[DEBUG] No file paths to process');
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
            
            console.log('[DEBUG] Working directory:', fileDir);
            console.log('[DEBUG] File names:', fileNames);
            
            let command = getCommandConfig('discard');
            if (!command) {
                command = 'soscmd discard ' + (useForce ? '-F' : '') + ' ' + filePaths.join(' ');
            } else {
                command = replaceCommandVariables(command, { filePath: filePaths.join(' '), useForce: useForce ? '-F' : '' });
            }
            
            console.log('[DEBUG] Final command to execute:', command);
            
            await executeSoscmd(command, fileDir);
            vscode.window.showInformationMessage('Discarded: ' + fileNames);
            console.log('[DEBUG] Discard command completed successfully');
            
            // 刷新文件状态，确保VSCode与SOS状态一致
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
                console.log(`[DEBUG] Office open command executed for: ${filePath}`);
            }
            
            let command = getCommandConfig('officeOpen');
            if (!command) {
                command = `soffice ${filePath}`;
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
                console.log(`[DEBUG] Rebuild ctags command executed for: ${filePath}`);
            }
            
            let command = getCommandConfig('rebuildCtags');
            if (!command) {
                command = `cd \${env:PROJ_ROOT} ; ctags -R --fields=+nKz -f .vscode/.tags --langmap=SystemVerilog:+.v+.sv -R --links=yes ./design_data/rtl ./design_data/testbench ./ref_ip`;
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
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            fileStatusDecorator.updateFileAndAncestors(document.uri.fsPath);
        })
    );
    
    // 监听文件打开事件
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            fileStatusDecorator.updateFileAndAncestors(document.uri.fsPath);
        })
    );
    
    // 监听资源管理器中的文件选择变化（包括非文本文件如.xlsx）
    // 使用VSCode的Tab Groups API来监听所有类型的标签页变化
    let lastActiveTab: string | undefined;
    
    // 监听标签页变化事件
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
    
    // 使用定时轮询来检测非文本文件（如.xlsx）的活动状态
    const tabChangeInterval = setInterval(async () => {
        try {
            // 获取所有标签组
            const tabGroups = vscode.window.tabGroups;
            if (tabGroups && tabGroups.activeTabGroup) {
                const activeTab = tabGroups.activeTabGroup.activeTab;
                if (activeTab && activeTab.input) {
                    // 处理不同类型的标签页输入
                    let filePath: string | undefined;
                    
                    // 检查是否是文本编辑器输入
                    if ((activeTab.input as any).uri) {
                        filePath = (activeTab.input as any).uri.fsPath;
                    }
                    // 检查是否是自定义编辑器输入（如.xlsx文件）
                    else if ((activeTab.input as any).viewType) {
                        // 对于自定义编辑器，尝试从其他属性获取文件路径
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
                            console.log(`[DEBUG] Active tab changed to: ${filePath}`);
                        }
                    }
                }
            }
        } catch (error) {
            if (isDebugEnabled()) {
                console.error(`[ERROR] Failed to check active tab:`, error);
            }
        }
    }, 500); // 每500毫秒检查一次
    
    context.subscriptions.push({
        dispose: () => {
            clearInterval(tabChangeInterval);
        }
    });
    
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
    
    context.subscriptions.push({
        dispose: () => {
            clearInterval(statusRefreshInterval);
        }
    });
    
    if (isDebugEnabled()) {
        console.log('[DEBUG] ClioSoft SOS Manager extension activated!');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activated!');
    }
}

export function deactivate() {
    console.log('ClioSoft SOS Manager extension deactivated!');
    
    if (fileStatusDecorator) {
        fileStatusDecorator.dispose();
    }
}

class FileStatusDecorator {
    private statusCache: Map<string, FileStatus> = new Map();
    private updatingFolders: Set<string> = new Set();
    private periodicUpdateTimer: NodeJS.Timeout | undefined;
    private readonly maxConcurrentUpdates = 5;
    private readonly decorationChangeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    private fileDecorationProvider: vscode.FileDecorationProvider;
    private fileDecorationProviderRegistration: vscode.Disposable | undefined;
    private isPaused: boolean = false;
    private statusBarItem: vscode.StatusBarItem;
    
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
    
    async updateFileAndAncestors(filePath: string): Promise<void> {
        if (this.isPaused) {
            return;
        }
        
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const workspaceFolder = workspaceFolders.find(folder => 
                filePath.startsWith(folder.uri.fsPath)
            );
            
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
                console.log(`[DEBUG] Updating ${foldersToUpdate.length} ancestor folders: ${foldersToUpdate.join(', ')}`);
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
                console.error(`[ERROR] Failed to update file and ancestors: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    
    async updateFolderStatus(folderPath: string): Promise<void> {
        if (this.updatingFolders.has(folderPath)) {
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
                console.log(`[DEBUG] Getting status for folder: ${folderPath}`);
            }
            
            const statusMap = await getFolderStatus(folderPath);
            
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Got ${statusMap.size} status entries from soscmd`);
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
                console.error(`[ERROR] Failed to update folder status for ${folderPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            this.updatingFolders.delete(folderPath);
        }
    }
    
    clearCache(): void {
        this.statusCache.clear();
    }
    
    dispose(): void {
        if (this.periodicUpdateTimer) {
            clearInterval(this.periodicUpdateTimer);
            this.periodicUpdateTimer = undefined;
        }
        
        this.decorationChangeEmitter.dispose();
        
        this.statusCache.clear();
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
