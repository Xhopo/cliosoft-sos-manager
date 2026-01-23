import * as vscode from 'vscode';
import * as path from 'path';
import { FileStatus, getFolderStatus, getFileVersions, switchFileVersion, executeSoscmd, FileVersion, getFileStatus } from './soscmd';
import { isDebugEnabled } from './utils';

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
            this.tooltip = `Version ${version.id} - ${version.ciBy} - ${version.ciTime}`;
            this.description = isCurrent ? 'Current' : '';
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

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkout', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const filePath = editor.document.uri.fsPath;
                const fileDir = path.dirname(filePath);
                const fileName = path.basename(filePath);
                
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Checkout command executed for: ${filePath}`);
                }
                
                const command = `soscmd co -Nlock ${filePath}`;
                await executeSoscmd(command, fileDir);
                vscode.window.showInformationMessage(`Checked out: ${fileName}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkin', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const filePath = editor.document.uri.fsPath;
                const fileDir = path.dirname(filePath);
                const fileName = path.basename(filePath);
                
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Checkin command executed for: ${filePath}`);
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
                
                const command = `soscmd ci -aLog=${comments} ${filePath}`;
                await executeSoscmd(command, fileDir);
                vscode.window.showInformationMessage(`Checked in: ${fileName}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.diff', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const filePath = editor.document.uri.fsPath;
                const fileDir = path.dirname(filePath);
                const fileName = path.basename(filePath);
                
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Diff command executed for: ${filePath}`);
                }
                
                const command = `soscmd diff ${filePath}`;
                await executeSoscmd(command, fileDir);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.discard', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const filePath = editor.document.uri.fsPath;
                const fileDir = path.dirname(filePath);
                const fileName = path.basename(filePath);
                
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Discard command executed for: ${filePath}`);
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
                const command = `soscmd discard ${useForce ? '-F' : ''} ${filePath}`;
                await executeSoscmd(command, fileDir);
                vscode.window.showInformationMessage(`Discarded: ${fileName}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.officeOpen', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const filePath = editor.document.uri.fsPath;
                const fileDir = path.dirname(filePath);
                
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Office open command executed for: ${filePath}`);
                }
                
                const command = `soffice ${filePath}`;
                await executeSoscmd(command, fileDir);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.rebuildCtags', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const filePath = editor.document.uri.fsPath;
                const fileDir = path.dirname(filePath);
                
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Rebuild ctags command executed for: ${filePath}`);
                }
                
                const command = `cd \${env:PROJ_ROOT} ; ctags -R --fields=+nKz -f .vscode/.tags --langmap=SystemVerilog:+.v+.sv -R --links=yes ./design_data/rtl ./design_data/testbench ./ref_ip`;
                await executeSoscmd(command, fileDir);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.toggleRefresh', () => {
            fileStatusDecorator.toggleRefresh();
        })
    );

    fileStatusDecorator = new FileStatusDecorator();
    
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document) {
                fileStatusDecorator.updateFileAndAncestors(editor.document.uri.fsPath);
                treeDataProvider.setFile(editor.document.uri.fsPath);
            }
        })
    );
    
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            fileStatusDecorator.updateFileAndAncestors(document.uri.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            fileStatusDecorator.updateFileAndAncestors(document.uri.fsPath);
        })
    );
    
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
                    badge = '🔓';
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
