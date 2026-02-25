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
const path = __importStar(require("path"));
const soscmd_1 = require("./soscmd");
const utils_1 = require("./utils");
// 获取配置
function getConfig() {
    return vscode.workspace.getConfiguration('cliosoft-sos-manager');
}
// 检查命令是否启用
function isCommandEnabled(commandName) {
    const config = getConfig();
    return config.get(`commands.${commandName}.enable`, true);
}
// 获取命令配置
function getCommandConfig(commandName) {
    const config = getConfig();
    return config.get(`commands.${commandName}.command`, '');
}
// 替换命令中的变量
function replaceCommandVariables(command, variables) {
    let result = command;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\$\{${key}\}`, 'g'), value);
    }
    return result;
}
// 刷新文件状态，确保VSCode与SOS状态一致
async function refreshFileStatus(filePaths) {
    for (const filePath of filePaths) {
        const fileUri = vscode.Uri.file(filePath);
        try {
            await vscode.workspace.fs.stat(fileUri);
            if (fileStatusDecorator) {
                await fileStatusDecorator.updateFileAndAncestors(filePath);
            }
            console.log(`[DEBUG] Completed file status refresh for ${filePath}`);
        }
        catch (error) {
            console.error(`[ERROR] Failed to refresh file status for ${filePath}:`, error);
        }
    }
    await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
}
const BATCH_SIZE = 50;
async function executeBatchCommand(filePaths, fileDir, buildCommand, commandName) {
    if (filePaths.length <= BATCH_SIZE) {
        const command = buildCommand(filePaths);
        console.log(`[DEBUG] ${commandName} command:`, command);
        await (0, soscmd_1.executeSoscmd)(command, fileDir);
    }
    else {
        const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);
        console.log(`[DEBUG] ${commandName}: Processing ${filePaths.length} files in ${totalBatches} batches`);
        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
            const batch = filePaths.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const command = buildCommand(batch);
            console.log(`[DEBUG] ${commandName} batch ${batchNum}/${totalBatches}:`, command);
            try {
                await (0, soscmd_1.executeSoscmd)(command, fileDir);
                vscode.window.showInformationMessage(`${commandName} batch ${batchNum}/${totalBatches} completed`);
            }
            catch (error) {
                vscode.window.showErrorMessage(`${commandName} batch ${batchNum}/${totalBatches} failed: ${error}`);
                throw error;
            }
        }
    }
}
// 定义文件版本树节点
class FileVersionItem extends vscode.TreeItem {
    constructor(version, filePath, isCurrent = false, collapsibleState = vscode.TreeItemCollapsibleState.None) {
        super(version ? version.id : 'No versions', collapsibleState);
        this.version = version;
        this.filePath = filePath;
        this.isCurrent = isCurrent;
        if (version === null) {
            this.tooltip = 'No versions available';
            this.description = '';
            this.contextValue = 'noVersions';
            this.iconPath = 'info';
        }
        else {
            this.tooltip = `Version ${version.id} - ${version.ciBy} - ${version.ciTime}\n${version.changeSummary}`;
            this.description = `${version.changeSummary}`;
            this.contextValue = 'fileVersion';
            if (isCurrent) {
                this.iconPath = new vscode.ThemeIcon('check');
                this.description = 'Current';
            }
            else {
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
class FileVersionsTreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.currentFilePath = null;
        this.currentFileStatus = null;
    }
    refresh() {
        this._onDidChangeTreeData.fire(null);
    }
    async setFile(filePath) {
        this.currentFilePath = filePath;
        this.currentFileStatus = await (0, soscmd_1.getFileStatus)(filePath);
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] File set to: ${filePath}`);
            console.log(`[DEBUG] File status: ${JSON.stringify(this.currentFileStatus)}`);
        }
        this.refresh();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        var _a;
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] getChildren called with element: ${element === null || element === void 0 ? void 0 : element.label}`);
        }
        if (!element) {
            if (!this.currentFilePath) {
                if ((0, utils_1.isDebugEnabled)()) {
                    console.log('[DEBUG] No file selected, returning noVersions item');
                }
                return [new FileVersionItem(null, null, false)];
            }
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Active file: ${this.currentFilePath}`);
            }
            const versions = await (0, soscmd_1.getFileVersions)(this.currentFilePath);
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] getFileVersions returned ${versions.length} versions`);
            }
            if (versions.length === 0) {
                if ((0, utils_1.isDebugEnabled)()) {
                    console.log(`[DEBUG] No versions found, returning noVersions item`);
                }
                return [new FileVersionItem(null, this.currentFilePath, false)];
            }
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Creating FileVersionItems for ${versions.length} versions`);
            }
            const currentRevision = ((_a = this.currentFileStatus) === null || _a === void 0 ? void 0 : _a.revision) || '';
            return versions.map(version => new FileVersionItem(version, this.currentFilePath, version.id === currentRevision));
        }
        return [];
    }
}
function activate(context) {
    if ((0, utils_1.isDebugEnabled)()) {
        (0, utils_1.logDebug)('ClioSoft SOS Manager extension activating...');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activating...');
    }
    const treeDataProvider = new FileVersionsTreeDataProvider();
    if ((0, utils_1.isDebugEnabled)()) {
        (0, utils_1.logDebug)('Tree data provider created');
    }
    vscode.window.registerTreeDataProvider('cliosoft-sos-manager.fileVersions', treeDataProvider);
    if ((0, utils_1.isDebugEnabled)()) {
        (0, utils_1.logDebug)('Tree view provider registered');
    }
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.refreshVersions', () => {
        if ((0, utils_1.isDebugEnabled)()) {
            (0, utils_1.logDebug)('Refresh versions command executed');
            vscode.window.showInformationMessage('[DEBUG] Refresh versions command executed');
        }
        treeDataProvider.refresh();
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        (0, utils_1.logDebug)('Refresh command registered');
    }
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.switchVersion', async (filePath, version) => {
        if ((0, utils_1.isDebugEnabled)()) {
            (0, utils_1.logDebug)(`Switch version command executed with filePath: ${filePath}, version: ${version === null || version === void 0 ? void 0 : version.id}`);
            vscode.window.showInformationMessage(`[DEBUG] Switch version command: ${filePath} -> v${version === null || version === void 0 ? void 0 : version.id}`);
        }
        if (filePath && version) {
            if ((0, utils_1.isDebugEnabled)()) {
                (0, utils_1.logDebug)(`Calling switchFileVersion for ${filePath} with version ${version.id}`);
            }
            await (0, soscmd_1.switchFileVersion)(filePath, version.id);
            if ((0, utils_1.isDebugEnabled)()) {
                (0, utils_1.logDebug)(`Re-fetching file status after version switch`);
            }
            await treeDataProvider.setFile(filePath);
            if ((0, utils_1.isDebugEnabled)()) {
                (0, utils_1.logDebug)(`Refreshing tree after version switch`);
            }
        }
        else {
            (0, utils_1.logError)(`Invalid parameters for switchVersion: filePath=${filePath}, version=${version}`);
        }
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        (0, utils_1.logDebug)('Switch version command registered');
    }
    // 全局变量用于处理多文件选择
    let pendingMultiFileCommands = {};
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.checkout', async (uri, uris) => {
        (0, utils_1.logDebug)('Checkout command called with uri:', uri);
        (0, utils_1.logDebug)('Checkout command called with uris:', uris);
        if (!isCommandEnabled('checkout')) {
            (0, utils_1.logDebug)('Checkout command is disabled');
            return;
        }
        const targetUris = uris || [uri];
        (0, utils_1.logDebug)('Target uris:', targetUris);
        const filePaths = targetUris.map(u => u.fsPath);
        (0, utils_1.logDebug)('File paths collected:', filePaths);
        if (filePaths.length === 0) {
            (0, utils_1.logDebug)('No file paths to process');
            return;
        }
        const fileDir = path.dirname(filePaths[0]);
        const fileNames = filePaths.map(function (p) { return path.basename(p); }).join(', ');
        (0, utils_1.logDebug)('Working directory:', fileDir);
        (0, utils_1.logDebug)('File names:', fileNames);
        await executeBatchCommand(filePaths, fileDir, (batch) => {
            let command = getCommandConfig('checkout');
            if (!command) {
                return 'soscmd co -Nlock ' + batch.map(p => `"${p}"`).join(' ');
            }
            else {
                return replaceCommandVariables(command, { filePath: batch.map(p => `"${p}"`).join(' ') });
            }
        }, 'Checkout');
        vscode.window.showInformationMessage('Checked out: ' + fileNames);
        console.log('[DEBUG] Checkout command completed successfully');
        await refreshFileStatus(filePaths);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.checkin', async (uri, uris) => {
        (0, utils_1.logDebug)('Checkin command called with uri:', uri);
        (0, utils_1.logDebug)('Checkin command called with uris:', uris);
        if (!isCommandEnabled('checkin')) {
            (0, utils_1.logDebug)('Checkin command is disabled');
            return;
        }
        const targetUris = uris || [uri];
        (0, utils_1.logDebug)('Target uris:', targetUris);
        const filePaths = targetUris.map(u => u.fsPath);
        (0, utils_1.logDebug)('File paths collected:', filePaths);
        if (filePaths.length === 0) {
            (0, utils_1.logDebug)('No file paths to process');
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
        const fileNames = filePaths.map(function (p) { return path.basename(p); }).join(', ');
        (0, utils_1.logDebug)('Working directory:', fileDir);
        (0, utils_1.logDebug)('File names:', fileNames);
        await executeBatchCommand(filePaths, fileDir, (batch) => {
            let command = getCommandConfig('checkin');
            if (!command) {
                return 'soscmd ci -aLog="' + comments + '" ' + batch.map(p => `"${p}"`).join(' ');
            }
            else {
                return replaceCommandVariables(command, { filePath: batch.map(p => `"${p}"`).join(' '), comments });
            }
        }, 'Checkin');
        vscode.window.showInformationMessage('Checked in: ' + fileNames);
        console.log('[DEBUG] Checkin command completed successfully');
        await refreshFileStatus(filePaths);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.diff', async (uri) => {
        if (!isCommandEnabled('diff')) {
            return;
        }
        let filePath;
        if (uri) {
            filePath = uri.fsPath;
        }
        else {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            filePath = editor.document.uri.fsPath;
        }
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        if ((0, utils_1.isDebugEnabled)()) {
            (0, utils_1.logDebug)(`Diff command executed for: ${filePath}`);
        }
        let command = getCommandConfig('diff');
        if (!command) {
            command = `soscmd diff -gui "${filePath}"`;
        }
        command = replaceCommandVariables(command, { filePath });
        await (0, soscmd_1.executeSoscmd)(command, fileDir);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.discard', async (uri, uris) => {
        (0, utils_1.logDebug)('Discard command called with uri:', uri);
        (0, utils_1.logDebug)('Discard command called with uris:', uris);
        if (!isCommandEnabled('discard')) {
            (0, utils_1.logDebug)('Discard command is disabled');
            return;
        }
        const targetUris = uris || [uri];
        (0, utils_1.logDebug)('Target uris:', targetUris);
        const filePaths = targetUris.map(u => u.fsPath);
        (0, utils_1.logDebug)('File paths collected:', filePaths);
        if (filePaths.length === 0) {
            (0, utils_1.logDebug)('No file paths to process');
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
        const fileNames = filePaths.map(function (p) { return path.basename(p); }).join(', ');
        (0, utils_1.logDebug)('Working directory:', fileDir);
        (0, utils_1.logDebug)('File names:', fileNames);
        await executeBatchCommand(filePaths, fileDir, (batch) => {
            let command = getCommandConfig('discard');
            if (!command) {
                return 'soscmd discard ' + (useForce ? '-F' : '') + ' ' + batch.map(p => `"${p}"`).join(' ');
            }
            else {
                return replaceCommandVariables(command, { filePath: batch.map(p => `"${p}"`).join(' '), useForce: useForce ? '-F' : '' });
            }
        }, 'Discard');
        vscode.window.showInformationMessage('Discarded: ' + fileNames);
        console.log('[DEBUG] Discard command completed successfully');
        await refreshFileStatus(filePaths);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.officeOpen', async (uri) => {
        if (!isCommandEnabled('officeOpen')) {
            return;
        }
        let filePath;
        if (uri) {
            filePath = uri.fsPath;
        }
        else {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            filePath = editor.document.uri.fsPath;
        }
        const fileDir = path.dirname(filePath);
        if ((0, utils_1.isDebugEnabled)()) {
            (0, utils_1.logDebug)(`Office open command executed for: ${filePath}`);
        }
        let command = getCommandConfig('officeOpen');
        if (!command) {
            command = `soffice "${filePath}"`;
        }
        command = replaceCommandVariables(command, { filePath });
        await (0, soscmd_1.executeSoscmd)(command, fileDir);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.rebuildCtags', async (uri) => {
        if (!isCommandEnabled('rebuildCtags')) {
            return;
        }
        let filePath;
        if (uri) {
            filePath = uri.fsPath;
        }
        else {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            filePath = editor.document.uri.fsPath;
        }
        const fileDir = path.dirname(filePath);
        if ((0, utils_1.isDebugEnabled)()) {
            (0, utils_1.logDebug)(`Rebuild ctags command executed for: ${filePath}`);
        }
        let command = getCommandConfig('rebuildCtags');
        if (!command) {
            command = `cd "\${env:PROJ_ROOT}" ; ctags -R --fields=+nKz -f .vscode/.tags --langmap=SystemVerilog:+.v+.sv -R --links=yes ./design_data/rtl ./design_data/testbench ./ref_ip`;
        }
        command = replaceCommandVariables(command, { filePath });
        await (0, soscmd_1.executeSoscmd)(command, fileDir);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.toggleRefresh', () => {
        fileStatusDecorator.toggleRefresh();
    }));
    fileStatusDecorator = new FileStatusDecorator();
    // 监听文本编辑器变化（文本文件）
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document) {
            fileStatusDecorator.updateFileAndAncestors(editor.document.uri.fsPath);
            treeDataProvider.setFile(editor.document.uri.fsPath);
        }
    }));
    // 监听文件保存事件
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        fileStatusDecorator.updateFileAndAncestors(document.uri.fsPath);
    }));
    // 监听文件打开事件
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        fileStatusDecorator.updateFileAndAncestors(document.uri.fsPath);
    }));
    // 监听资源管理器中的文件选择变化（包括非文本文件如.xlsx）
    // 使用VSCode的Tab Groups API来监听所有类型的标签页变化
    let lastActiveTab;
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
            var _a;
            try {
                const activeTab = (_a = vscode.window.tabGroups.activeTabGroup) === null || _a === void 0 ? void 0 : _a.activeTab;
                if (activeTab && activeTab.input) {
                    let filePath;
                    if (activeTab.input.uri) {
                        filePath = activeTab.input.uri.fsPath;
                    }
                    else if (activeTab.input.viewType) {
                        const input = activeTab.input;
                        if (input.uri) {
                            filePath = input.uri.fsPath;
                        }
                    }
                    if (filePath && filePath !== lastActiveTab) {
                        lastActiveTab = filePath;
                        fileStatusDecorator.updateFileAndAncestors(filePath);
                        treeDataProvider.setFile(filePath);
                        if ((0, utils_1.isDebugEnabled)()) {
                            (0, utils_1.logDebug)(`Active tab changed to: ${filePath}`);
                        }
                    }
                }
            }
            catch (error) {
                if ((0, utils_1.isDebugEnabled)()) {
                    (0, utils_1.logError)(`Failed to check active tab:`, error);
                }
            }
        });
        context.subscriptions.push(tabGroupsListener);
    }
    else {
        if ((0, utils_1.isDebugEnabled)()) {
            (0, utils_1.logDebug)('tabGroups.onDidChangeTabs not available, using fallback polling');
        }
        const tabChangeInterval = setInterval(async () => {
            try {
                const tabGroups = vscode.window.tabGroups;
                if (tabGroups && tabGroups.activeTabGroup) {
                    const activeTab = tabGroups.activeTabGroup.activeTab;
                    if (activeTab && activeTab.input) {
                        let filePath;
                        if (activeTab.input.uri) {
                            filePath = activeTab.input.uri.fsPath;
                        }
                        else if (activeTab.input.viewType) {
                            const input = activeTab.input;
                            if (input.uri) {
                                filePath = input.uri.fsPath;
                            }
                        }
                        if (filePath && filePath !== lastActiveTab) {
                            lastActiveTab = filePath;
                            fileStatusDecorator.updateFileAndAncestors(filePath);
                            treeDataProvider.setFile(filePath);
                            if ((0, utils_1.isDebugEnabled)()) {
                                (0, utils_1.logDebug)(`Active tab changed to: ${filePath}`);
                            }
                        }
                    }
                }
            }
            catch (error) {
                if ((0, utils_1.isDebugEnabled)()) {
                    (0, utils_1.logError)(`Failed to check active tab:`, error);
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
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        fileStatusDecorator.clearCache();
    }));
    context.subscriptions.push({
        dispose: () => {
            clearInterval(statusRefreshInterval);
        }
    });
    if ((0, utils_1.isDebugEnabled)()) {
        (0, utils_1.logDebug)('ClioSoft SOS Manager extension activated!');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activated!');
    }
}
function deactivate() {
    (0, utils_1.logDebug)('ClioSoft SOS Manager extension deactivated!');
    if (fileStatusDecorator) {
        fileStatusDecorator.dispose();
    }
}
class FileStatusDecorator {
    constructor() {
        this.statusCache = new Map();
        this.updatingFolders = new Set();
        this.maxConcurrentUpdates = 5;
        this.decorationChangeEmitter = new vscode.EventEmitter();
        this.isPaused = false;
        this.statusBarItem = vscode.window.createStatusBarItem('cliosoft-sos-manager.refreshToggle', vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = '$(sync~spin) Refreshing...';
        this.statusBarItem.command = 'cliosoft-sos-manager.toggleRefresh';
        this.statusBarItem.tooltip = 'Click to pause/resume status refresh';
        this.statusBarItem.show();
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
                    badge = '🔑';
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
    }
    toggleRefresh() {
        this.isPaused = !this.isPaused;
        if (this.isPaused) {
            this.statusBarItem.text = '$(debug-pause) Paused';
            this.statusBarItem.tooltip = 'Status refresh is paused. Click to resume.';
        }
        else {
            this.statusBarItem.text = '$(sync~spin) Refreshing...';
            this.statusBarItem.tooltip = 'Status refresh is active. Click to pause.';
        }
    }
    async updateFileAndAncestors(filePath) {
        if (this.isPaused) {
            return;
        }
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
            if (!workspaceFolder) {
                return;
            }
            const foldersToUpdate = [];
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
            if ((0, utils_1.isDebugEnabled)()) {
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
        }
        catch (error) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.error(`[ERROR] Failed to update file and ancestors: ${error instanceof Error ? error.message : String(error)}`);
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
    clearCache() {
        this.statusCache.clear();
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
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
        }
    }
}
let fileStatusDecorator;
//# sourceMappingURL=extension.js.map