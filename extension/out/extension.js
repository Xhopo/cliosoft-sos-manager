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
// 定义文件版本树节点
class FileVersionItem extends vscode.TreeItem {
    constructor(version, filePath, collapsibleState = vscode.TreeItemCollapsibleState.None) {
        // super()必须是构造函数的第一个语句
        super(version ? version.id : 'File not managed by ClioSoft SOS', collapsibleState);
        this.version = version;
        this.filePath = filePath;
        // 设置节点属性
        if (version === null) {
            // 提示节点
            this.tooltip = 'This file is not managed by ClioSoft SOS. Please open a file that is under SOS control.';
            this.description = 'Not in SOS';
            this.contextValue = 'notInSOS';
            this.iconPath = 'info';
            this.command = undefined;
        }
        else {
            // 正常版本节点
            this.tooltip = `${version.ciBy} - ${version.ciTime}\n${version.changeSummary}`;
            this.description = `${version.ciBy} | ${version.ciTime}`;
            this.contextValue = 'fileVersion';
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
    }
    refresh() {
        this._onDidChangeTreeData.fire(null);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] getChildren called with element: ${element === null || element === void 0 ? void 0 : element.label}`);
        }
        if (!element) {
            // 获取当前打开的文件
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                if ((0, utils_1.isDebugEnabled)()) {
                    console.log('[DEBUG] No active editor, returning notInSOS item');
                }
                return [new FileVersionItem(null, null)];
            }
            const filePath = activeEditor.document.uri.fsPath;
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Active file: ${filePath}`);
            }
            // 使用soscmd获取文件版本列表
            if ((0, utils_1.isDebugEnabled)()) {
                console.log('[DEBUG] Calling getFileVersions...');
            }
            const versions = await (0, soscmd_1.getFileVersions)(filePath);
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] getFileVersions returned ${versions.length} versions`);
            }
            if (versions.length === 0) {
                // 文件不在SOS管理下，显示提示信息
                if ((0, utils_1.isDebugEnabled)()) {
                    console.log(`[DEBUG] No versions found, returning notInSOS item`);
                }
                return [new FileVersionItem(null, null)];
            }
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Creating FileVersionItems for ${versions.length} versions`);
            }
            return versions.map(version => new FileVersionItem(version, filePath));
        }
        if ((0, utils_1.isDebugEnabled)()) {
            console.log('[DEBUG] Element provided, returning empty array (no children)');
        }
        return [];
    }
}
function activate(context) {
    // 输出激活信息，只在调试模式下显示
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] ClioSoft SOS Manager extension activating...');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activating...');
    }
    // 创建树数据提供程序
    const treeDataProvider = new FileVersionsTreeDataProvider();
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Tree data provider created');
    }
    // 注册视图提供程序
    vscode.window.registerTreeDataProvider('cliosoft-sos-manager.fileVersions', treeDataProvider);
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Tree view provider registered');
    }
    // 注册刷新命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.refreshVersions', () => {
        if ((0, utils_1.isDebugEnabled)()) {
            console.log('[DEBUG] Refresh versions command executed');
            vscode.window.showInformationMessage('[DEBUG] Refresh versions command executed');
        }
        treeDataProvider.refresh();
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Refresh command registered');
    }
    // 注册切换版本命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.switchVersion', async (filePath, version) => {
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Switch version command executed with filePath: ${filePath}, version: ${version === null || version === void 0 ? void 0 : version.id}`);
            vscode.window.showInformationMessage(`[DEBUG] Switch version command: ${filePath} -> v${version === null || version === void 0 ? void 0 : version.id}`);
        }
        if (filePath && version) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Calling switchFileVersion for ${filePath} with version ${version.id}`);
            }
            await (0, soscmd_1.switchFileVersion)(filePath, version.id);
            // 刷新版本列表
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Refreshing tree after version switch`);
            }
            treeDataProvider.refresh();
        }
        else {
            // 错误信息始终显示
            console.error(`[ERROR] Invalid parameters for switchVersion: filePath=${filePath}, version=${version}`);
        }
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Switch version command registered');
    }
    // 注册Checkout命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.checkout', async (context) => {
        const filePath = (0, utils_1.getSelectedFilePath)(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        const fileName = require('path').basename(filePath);
        const fileDir = require('path').dirname(filePath);
        const command = `soscmd co -Nlock "${fileName}"`;
        vscode.window.showInformationMessage(`Checking out ${fileName}...`);
        await (0, utils_1.executeCommand)(command, fileDir);
        vscode.window.showInformationMessage(`Successfully checked out ${fileName}`);
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Checkout command registered');
    }
    // 注册Checkin命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.checkin', async (context) => {
        const filePath = (0, utils_1.getSelectedFilePath)(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        const fileName = require('path').basename(filePath);
        const fileDir = require('path').dirname(filePath);
        const command = `soscmd ci "${fileName}" -mm`;
        vscode.window.showInformationMessage(`Checking in ${fileName}...`);
        await (0, utils_1.executeCommand)(command, fileDir);
        vscode.window.showInformationMessage(`Successfully checked in ${fileName}`);
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Checkin command registered');
    }
    // 注册Diff命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.diff', async (context) => {
        const filePath = (0, utils_1.getSelectedFilePath)(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        const fileName = require('path').basename(filePath);
        const fileDir = require('path').dirname(filePath);
        const command = `soscmd diff "${fileName}" -gui`;
        vscode.window.showInformationMessage(`Generating diff for ${fileName}...`);
        await (0, utils_1.executeCommand)(command, fileDir);
        vscode.window.showInformationMessage(`Diff generated for ${fileName}`);
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Diff command registered');
    }
    // 注册Discard命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.discard', async (context) => {
        const filePath = (0, utils_1.getSelectedFilePath)(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        // 询问用户是否强制discard
        const confirmResult = await vscode.window.showWarningMessage('Do you want to force discard?', { modal: true }, 'Yes', 'No');
        const forceFlag = confirmResult === 'Yes' ? '-F' : '';
        const fileName = require('path').basename(filePath);
        const fileDir = require('path').dirname(filePath);
        const command = `soscmd discardco ${forceFlag} "${fileName}"`;
        vscode.window.showInformationMessage(`Discarding changes for ${fileName}...`);
        await (0, utils_1.executeCommand)(command, fileDir);
        vscode.window.showInformationMessage(`Successfully discarded changes for ${fileName}`);
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Discard command registered');
    }
    // 注册Office Open命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.officeOpen', async (context) => {
        const filePath = (0, utils_1.getSelectedFilePath)(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        const command = `soffice "${filePath}" &`;
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Opening file in Office: ${filePath}`);
        }
        await (0, utils_1.executeCommand)(command);
        vscode.window.showInformationMessage(`Opened file in Office: ${require('path').basename(filePath)}`);
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Office Open command registered');
    }
    // 注册Compile RTL命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.compileRtl', async () => {
        // 提示用户输入TESTCASE
        const testcase = await vscode.window.showInputBox({
            prompt: 'Enter TESTCASE value:',
            placeHolder: 'hello',
            value: 'hello'
        });
        if (!testcase) {
            vscode.window.showErrorMessage('TESTCASE is required');
            return;
        }
        // 获取PROJ_ROOT环境变量
        const projRoot = process.env.PROJ_ROOT;
        if (!projRoot) {
            vscode.window.showErrorMessage('PROJ_ROOT environment variable is not set');
            return;
        }
        const command = `cd "${projRoot}/design_data/testbench/digital_top" ; make TESTCASE=${testcase} ; cd -`;
        vscode.window.showInformationMessage('Compiling RTL...');
        await (0, utils_1.executeCommand)(command);
        vscode.window.showInformationMessage('RTL compilation completed');
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Compile RTL command registered');
    }
    // 注册Rebuild Ctags命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.rebuildCtags', async () => {
        // 获取PROJ_ROOT环境变量
        const projRoot = process.env.PROJ_ROOT;
        if (!projRoot) {
            vscode.window.showErrorMessage('PROJ_ROOT environment variable is not set');
            return;
        }
        const command = `cd "${projRoot}" ; ctags -R --fields=+nKz -f .vscode/.tags --langmap=SystemVerilog:+.v+.sv -R --links=yes ./design_data/rtl ./design_data/testbench ./ref_ip`;
        vscode.window.showInformationMessage('Rebuilding ctags...');
        await (0, utils_1.executeCommand)(command);
        vscode.window.showInformationMessage('Ctags rebuilt successfully');
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Rebuild Ctags command registered');
    }
    // 监听编辑器切换事件，自动刷新版本列表
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if ((0, utils_1.isDebugEnabled)()) {
            if (editor) {
                console.log(`[DEBUG] Active editor changed to: ${editor.document.uri.fsPath}`);
                vscode.window.showInformationMessage(`[DEBUG] Active editor changed to: ${editor.document.uri.fsPath}`);
            }
            else {
                console.log('[DEBUG] Active editor closed');
                vscode.window.showInformationMessage('[DEBUG] Active editor closed');
            }
        }
        treeDataProvider.refresh();
    }));
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] Editor change listener registered');
    }
    if ((0, utils_1.isDebugEnabled)()) {
        console.log('[DEBUG] ClioSoft SOS Manager extension activated!');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activated!');
    }
    // 初始化文件状态装饰器
    fileStatusDecorator = new FileStatusDecorator();
    // 立即更新所有可见文件的状态
    fileStatusDecorator.updateVisibleFilesStatus();
    // 监听编辑器切换事件，更新状态
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        fileStatusDecorator.updateVisibleFilesStatus();
    }));
    // 监听编辑器打开事件，更新状态
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
        fileStatusDecorator.updateVisibleFilesStatus();
    }));
    // 监听文件保存事件，更新状态
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        fileStatusDecorator.updateFileStatus(document.uri.fsPath);
    }));
    // 监听文件打开事件
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        fileStatusDecorator.updateFileStatus(document.uri.fsPath);
    }));
    // 定期刷新所有可见文件的状态（每30秒）
    const statusRefreshInterval = setInterval(async () => {
        fileStatusDecorator.updateVisibleFilesStatus();
    }, 30000);
    // 监听文件系统变化，更新状态
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        fileStatusDecorator.updateVisibleFilesStatus();
    }));
    // 添加清理任务
    context.subscriptions.push({
        dispose: () => {
            clearInterval(statusRefreshInterval);
        }
    });
}
// 文件状态装饰器类
class FileStatusDecorator {
    constructor() {
        // 缓存文件状态，避免重复调用soscmd
        this.statusCache = new Map();
        // 正在更新的文件路径集合，避免重复更新
        this.updatingFiles = new Set();
        // 是否正在批量更新中
        this.isBatchUpdating = false;
        // 批量更新队列
        this.batchUpdateQueue = new Set();
        // 批量更新延迟时间（毫秒）
        this.batchUpdateDelay = 100;
        // 实现文件装饰提供程序
        this.fileDecorationProvider = {
            provideFileDecoration: (uri) => {
                const filePath = uri.fsPath;
                const status = this.statusCache.get(filePath);
                if (!status) {
                    return undefined;
                }
                // 根据文件状态确定装饰
                let badge = '';
                let color = undefined;
                let tooltip = '';
                // 设置徽章和颜色
                if (status.state === 'O' || status.state === 'W') {
                    badge = '🔓'; // 已检出
                    color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
                    tooltip = 'Checked Out';
                }
                else if (status.state === '-') {
                    // 如果是CI状态，则认为是带锁的
                    badge = '🔒'; // 已检入/带锁
                    color = new vscode.ThemeColor('gitDecoration.untrackedResourceForeground');
                    tooltip = 'Checked In (Locked)';
                }
                if (status.change === 'M') {
                    badge = '✏️'; // 已修改
                    color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
                    tooltip = 'Modified';
                }
                if (status.newRevision === 'N') {
                    badge += '⚠️'; // 有新版本
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
            }
        };
        // 注册文件装饰提供程序
        this.fileDecorationProviderRegistration = vscode.window.registerFileDecorationProvider(this.fileDecorationProvider);
    }
    // 更新单个文件的状态装饰 - 异步非阻塞
    async updateFileStatus(filePath) {
        // 跳过无效文件路径
        if (!this.isValidFilePath(filePath)) {
            this.statusCache.delete(filePath);
            this.triggerDecorationUpdate();
            return;
        }
        // 如果正在更新，跳过
        if (this.updatingFiles.has(filePath)) {
            return;
        }
        // 如果正在批量更新，加入队列
        if (this.isBatchUpdating) {
            this.batchUpdateQueue.add(filePath);
            return;
        }
        // 开始更新
        this.updatingFiles.add(filePath);
        try {
            // 检查文件是否存在
            const fs = require('fs');
            if (!fs.existsSync(filePath)) {
                if ((0, utils_1.isDebugEnabled)()) {
                    console.log(`[DEBUG] File not found: ${filePath}`);
                }
                this.statusCache.delete(filePath);
                return;
            }
            // 获取文件状态
            const status = await (0, soscmd_1.getFileStatus)(filePath);
            if (!status) {
                this.statusCache.delete(filePath);
            }
            else {
                // 更新缓存
                this.statusCache.set(filePath, status);
            }
        }
        catch (error) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.error(`[ERROR] Failed to update file status for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
            }
            this.statusCache.delete(filePath);
        }
        finally {
            // 移除更新标记
            this.updatingFiles.delete(filePath);
            // 触发装饰更新
            this.triggerDecorationUpdate();
        }
    }
    // 批量更新文件状态 - 异步非阻塞
    async batchUpdateFileStatus(filePaths) {
        // 如果正在批量更新，加入队列并返回
        if (this.isBatchUpdating) {
            filePaths.forEach(filePath => this.batchUpdateQueue.add(filePath));
            return;
        }
        // 标记为正在批量更新
        this.isBatchUpdating = true;
        try {
            // 过滤掉无效文件路径
            const validFilePaths = filePaths.filter(this.isValidFilePath.bind(this));
            // 并行更新所有文件状态
            await Promise.all(validFilePaths.map(async (filePath) => {
                // 跳过正在更新的文件
                if (this.updatingFiles.has(filePath)) {
                    return;
                }
                this.updatingFiles.add(filePath);
                try {
                    // 检查文件是否存在
                    const fs = require('fs');
                    if (!fs.existsSync(filePath)) {
                        this.statusCache.delete(filePath);
                        return;
                    }
                    // 获取文件状态
                    const status = await (0, soscmd_1.getFileStatus)(filePath);
                    if (!status) {
                        this.statusCache.delete(filePath);
                    }
                    else {
                        // 更新缓存
                        this.statusCache.set(filePath, status);
                    }
                }
                catch (error) {
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.error(`[ERROR] Failed to update file status for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    this.statusCache.delete(filePath);
                }
                finally {
                    this.updatingFiles.delete(filePath);
                }
            }));
            // 触发装饰更新
            this.triggerDecorationUpdate();
        }
        finally {
            // 标记为批量更新完成
            this.isBatchUpdating = false;
            // 检查是否有新的更新请求
            if (this.batchUpdateQueue.size > 0) {
                // 处理队列中的更新请求
                const queue = Array.from(this.batchUpdateQueue);
                this.batchUpdateQueue.clear();
                // 延迟执行，避免过于频繁的更新
                if (this.batchUpdateTimer) {
                    clearTimeout(this.batchUpdateTimer);
                }
                this.batchUpdateTimer = setTimeout(() => {
                    this.batchUpdateFileStatus(queue);
                }, this.batchUpdateDelay);
            }
        }
    }
    // 更新可视文件和文件夹的状态
    async updateVisibleFilesStatus() {
        try {
            // 获取所有打开的编辑器文件
            const openedFiles = vscode.window.visibleTextEditors.map(editor => editor.document.uri.fsPath);
            // 获取所有可见的文件和文件夹
            const visibleFiles = await this.getVisibleFiles();
            // 合并所有需要更新的文件路径
            const allFilesToUpdate = new Set([...openedFiles, ...visibleFiles]);
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Updating status for ${allFilesToUpdate.size} visible files`);
            }
            // 批量更新文件状态
            await this.batchUpdateFileStatus(Array.from(allFilesToUpdate));
        }
        catch (error) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.error(`[ERROR] Failed to update visible files status: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    // 获取所有可见的文件和文件夹
    async getVisibleFiles() {
        const visibleFiles = [];
        try {
            // 获取所有工作区文件夹
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            for (const folder of workspaceFolders) {
                // 递归获取文件夹下的所有文件
                await this.getAllFilesInFolder(folder.uri.fsPath, visibleFiles);
            }
        }
        catch (error) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.error(`[ERROR] Failed to get visible files: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return visibleFiles;
    }
    // 递归获取文件夹下的所有文件
    async getAllFilesInFolder(folderPath, result) {
        try {
            const fs = require('fs');
            const items = fs.readdirSync(folderPath, { withFileTypes: true });
            for (const item of items) {
                const itemPath = path.join(folderPath, item.name);
                if (item.isFile()) {
                    result.push(itemPath);
                }
                else if (item.isDirectory()) {
                    // 递归处理子文件夹
                    await this.getAllFilesInFolder(itemPath, result);
                }
            }
        }
        catch (error) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.error(`[ERROR] Failed to read folder: ${folderPath}, error: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    // 检查文件路径是否有效
    isValidFilePath(filePath) {
        if (!filePath || typeof filePath !== 'string' || filePath.length === 0) {
            return false;
        }
        // 跳过VSCode内部文件
        if (filePath.includes('sharedprocess') ||
            filePath.includes('vscode-extension-host') ||
            filePath.includes('file://') ||
            (!filePath.includes('/') && !filePath.includes(':'))) {
            return false;
        }
        return true;
    }
    // 触发文件装饰更新
    triggerDecorationUpdate() {
        var _a;
        // 使用VSCode的API通知装饰已更改
        (_a = this.fileDecorationProviderRegistration) === null || _a === void 0 ? void 0 : _a.dispose();
        this.fileDecorationProviderRegistration = vscode.window.registerFileDecorationProvider(this.fileDecorationProvider);
    }
    // 清理资源
    dispose() {
        // 清理定时器
        if (this.batchUpdateTimer) {
            clearTimeout(this.batchUpdateTimer);
            this.batchUpdateTimer = undefined;
        }
        // 清理缓存
        this.statusCache.clear();
        this.updatingFiles.clear();
        this.batchUpdateQueue.clear();
        // 注销文件装饰提供程序
        if (this.fileDecorationProviderRegistration) {
            this.fileDecorationProviderRegistration.dispose();
            this.fileDecorationProviderRegistration = undefined;
        }
    }
}
// 创建全局装饰器实例
let fileStatusDecorator;
function deactivate() {
    console.log('ClioSoft SOS Manager extension deactivated!');
    // 清理装饰器资源
    if (fileStatusDecorator) {
        fileStatusDecorator.dispose();
    }
}
//# sourceMappingURL=extension.js.map