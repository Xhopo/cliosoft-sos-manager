"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const soscmd_1 = require("./soscmd");
const utils_1 = require("./utils");
function activate(context) {
    if ((0, utils_1.isDebugEnabled)()) {
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
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        fileStatusDecorator.updateWorkspaceFoldersStatus();
    }));
    // 添加清理任务
    context.subscriptions.push({
        dispose: () => {
            clearInterval(statusRefreshInterval);
        }
    });
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] ClioSoft SOS Manager extension activated!');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activated!');
    }
}
function deactivate() {
    console.log('ClioSoft SOS Manager extension deactivated!');
    if (fileStatusDecorator) {
        fileStatusDecorator.dispose();
    }
}
// 文件状态装饰器类
class FileStatusDecorator {
    constructor() {
        this.statusCache = new Map();
        this.updatingFolders = new Set();
        this.periodicUpdateInterval = 30000;
        this.maxConcurrentUpdates = 5;
        this.decorationChangeEmitter = new vscode.EventEmitter();
        this.fileDecorationProvider = {
            provideFileDecoration: (uri) => {
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
                }
                else if (status.state === '-') {
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
    startPeriodicUpdates() {
        this.periodicUpdateTimer = setInterval(async () => {
            await this.updateWorkspaceFoldersStatus();
        }, this.periodicUpdateInterval);
    }
    async updateWorkspaceFoldersStatus() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            if ((0, utils_1.isDebugEnabled)()) {
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
        }
        catch (error) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.error(`[ERROR] Failed to update workspace folders status: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    async updateFolderStatus(folderPath) {
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
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Getting status for folder: ${folderPath}`);
            }
            const statusMap = await (0, soscmd_1.getFolderStatus)(folderPath);
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Got ${statusMap.size} status entries from soscmd`);
            }
            const updatedPaths = [];
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
                    }
                    catch {
                        return null;
                    }
                })
                    .filter((uri) => uri !== null);
                if (uris.length > 0) {
                    this.decorationChangeEmitter.fire(uris);
                }
            }
        }
        catch (error) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.error(`[ERROR] Failed to update folder status for ${folderPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        finally {
            this.updatingFolders.delete(folderPath);
        }
    }
    dispose() {
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
let fileStatusDecorator;
//# sourceMappingURL=extension.js.map