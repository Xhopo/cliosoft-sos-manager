import * as vscode from 'vscode';
import * as path from 'path';
import { FileStatus, getFolderStatus } from './soscmd';
import { isDebugEnabled } from './utils';

export function activate(context: vscode.ExtensionContext) {
    if (isDebugEnabled()) {
        console.log('[DEBUG] ClioSoft SOS Manager extension activating...');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activating...');
    }
    
    // 初始化文件状态装饰器
    fileStatusDecorator = new FileStatusDecorator();
    
    // 定期刷新工作区根目录的状态（每5秒）
    const statusRefreshInterval = setInterval(async () => {
        fileStatusDecorator.updateWorkspaceFoldersStatus();
    }, 5000);
    
    // 监听文件系统变化，更新状态
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            fileStatusDecorator.updateWorkspaceFoldersStatus();
        })
    );
    
    // 添加清理任务
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

// 文件状态装饰器类
class FileStatusDecorator {
    private statusCache: Map<string, FileStatus> = new Map();
    private updatingFolders: Set<string> = new Set();
    private periodicUpdateTimer: NodeJS.Timeout | undefined;
    private readonly periodicUpdateInterval = 30000;
    private readonly maxConcurrentUpdates = 5;
    private readonly decorationChangeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    private fileDecorationProvider: vscode.FileDecorationProvider;
    private fileDecorationProviderRegistration: vscode.Disposable | undefined;
    
    constructor() {
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
        
        this.startPeriodicUpdates();
    }
    
    private startPeriodicUpdates(): void {
        this.periodicUpdateTimer = setInterval(async () => {
            await this.updateWorkspaceFoldersStatus();
        }, this.periodicUpdateInterval);
    }
    
    async updateWorkspaceFoldersStatus(): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Updating ${workspaceFolders.length} workspace folders`);
            }
            
            const chunkSize = Math.min(this.maxConcurrentUpdates, workspaceFolders.length);
            
            for (let i = 0; i < workspaceFolders.length; i += chunkSize) {
                const chunk = workspaceFolders.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (workspaceFolder) => {
                    await this.updateFolderStatus(workspaceFolder.uri.fsPath);
                }));
                
                if (i + chunkSize < workspaceFolders.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        } catch (error) {
            if (isDebugEnabled()) {
                console.error(`[ERROR] Failed to update workspace folders status: ${error instanceof Error ? error.message : String(error)}`);
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
    }
}

let fileStatusDecorator: FileStatusDecorator;
