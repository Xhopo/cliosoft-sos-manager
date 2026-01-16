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
// 调试信息配置键
const DEBUG_INFO_CONFIG_KEY = 'cliosoft-sos-manager.enableDebugInfo';
// 获取调试开关状态
function isDebugEnabled() {
    return vscode.workspace.getConfiguration().get(DEBUG_INFO_CONFIG_KEY, false);
}
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
    get children() {
        return undefined;
    }
}
// 文件版本树数据提供程序
class FileVersionsTreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (isDebugEnabled()) {
            console.log(`[DEBUG] getChildren called with element: ${element === null || element === void 0 ? void 0 : element.label}`);
        }
        if (!element) {
            // 获取当前打开的文件
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                if (isDebugEnabled()) {
                    console.log('[DEBUG] No active editor, returning notInSOS item');
                }
                return [new FileVersionItem(null, null)];
            }
            const filePath = activeEditor.document.uri.fsPath;
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Active file: ${filePath}`);
            }
            // 使用soscmd获取文件版本列表
            if (isDebugEnabled()) {
                console.log('[DEBUG] Calling getFileVersions...');
            }
            const versions = await (0, soscmd_1.getFileVersions)(filePath);
            if (isDebugEnabled()) {
                console.log(`[DEBUG] getFileVersions returned ${versions.length} versions`);
            }
            if (versions.length === 0) {
                // 文件不在SOS管理下，显示提示信息
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] No versions found, returning notInSOS item`);
                }
                return [new FileVersionItem(null, null)];
            }
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Creating FileVersionItems for ${versions.length} versions`);
            }
            return versions.map(version => new FileVersionItem(version, filePath));
        }
        if (isDebugEnabled()) {
            console.log('[DEBUG] Element provided, returning empty array (no children)');
        }
        return [];
    }
}
// 执行命令的通用函数
async function executeCommand(command, cwd) {
    if (isDebugEnabled()) {
        console.log(`[DEBUG] Executing command: ${command}`);
        if (cwd) {
            console.log(`[DEBUG] Working directory: ${cwd}`);
        }
    }
    try {
        // 使用child_process执行命令
        const { exec } = require('child_process');
        return new Promise((resolve, reject) => {
            exec(command, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    const errorMessage = `Command execution failed: ${error.message}\nCommand: ${command}\nstdout: ${stdout}\nstderr: ${stderr}`;
                    console.error(`[ERROR] ${errorMessage}`);
                    vscode.window.showErrorMessage(errorMessage);
                    reject(new Error(errorMessage));
                    return;
                }
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Command executed successfully`);
                    console.log(`[DEBUG] stdout: ${stdout}`);
                    if (stderr) {
                        console.log(`[DEBUG] stderr: ${stderr}`);
                    }
                }
                resolve();
            });
        });
    }
    catch (error) {
        const errorMessage = `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[ERROR] ${errorMessage}`);
        vscode.window.showErrorMessage(errorMessage);
        throw error;
    }
}
// 获取当前选中的文件路径
function getSelectedFilePath(context) {
    if (context && context.fsPath) {
        return context.fsPath;
    }
    // 如果没有上下文，尝试获取当前活动编辑器的文件
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return activeEditor.document.uri.fsPath;
    }
    return null;
}
function activate(context) {
    // 输出激活信息，只在调试模式下显示
    if (isDebugEnabled()) {
        console.log('[DEBUG] ClioSoft SOS Manager extension activating...');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activating...');
    }
    // 创建树数据提供程序
    const treeDataProvider = new FileVersionsTreeDataProvider();
    if (isDebugEnabled()) {
        console.log('[DEBUG] Tree data provider created');
    }
    // 注册视图提供程序
    vscode.window.registerTreeDataProvider('cliosoft-sos-manager.fileVersions', treeDataProvider);
    if (isDebugEnabled()) {
        console.log('[DEBUG] Tree view provider registered');
    }
    // 注册刷新命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.refreshVersions', () => {
        if (isDebugEnabled()) {
            console.log('[DEBUG] Refresh versions command executed');
            vscode.window.showInformationMessage('[DEBUG] Refresh versions command executed');
        }
        treeDataProvider.refresh();
    }));
    if (isDebugEnabled()) {
        console.log('[DEBUG] Refresh command registered');
    }
    // 注册切换版本命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.switchVersion', async (filePath, version) => {
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Switch version command executed with filePath: ${filePath}, version: ${version === null || version === void 0 ? void 0 : version.id}`);
            vscode.window.showInformationMessage(`[DEBUG] Switch version command: ${filePath} -> v${version === null || version === void 0 ? void 0 : version.id}`);
        }
        if (filePath && version) {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Calling switchFileVersion for ${filePath} with version ${version.id}`);
            }
            await (0, soscmd_1.switchFileVersion)(filePath, version.id);
            // 刷新版本列表
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Refreshing tree after version switch`);
            }
            treeDataProvider.refresh();
        }
        else {
            // 错误信息始终显示
            console.error(`[ERROR] Invalid parameters for switchVersion: filePath=${filePath}, version=${version}`);
        }
    }));
    if (isDebugEnabled()) {
        console.log('[DEBUG] Switch version command registered');
    }
    // 注册Checkout命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.checkout', async (context) => {
        const filePath = getSelectedFilePath(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        const fileName = require('path').basename(filePath);
        const fileDir = require('path').dirname(filePath);
        const command = `soscmd co -Nlock "${fileName}"`;
        vscode.window.showInformationMessage(`Checking out ${fileName}...`);
        await executeCommand(command, fileDir);
        vscode.window.showInformationMessage(`Successfully checked out ${fileName}`);
    }));
    if (isDebugEnabled()) {
        console.log('[DEBUG] Checkout command registered');
    }
    // 注册Checkin命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.checkin', async (context) => {
        const filePath = getSelectedFilePath(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        const fileName = require('path').basename(filePath);
        const fileDir = require('path').dirname(filePath);
        const command = `soscmd ci "${fileName}" -mm`;
        vscode.window.showInformationMessage(`Checking in ${fileName}...`);
        await executeCommand(command, fileDir);
        vscode.window.showInformationMessage(`Successfully checked in ${fileName}`);
    }));
    if (isDebugEnabled()) {
        console.log('[DEBUG] Checkin command registered');
    }
    // 注册Diff命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.diff', async (context) => {
        const filePath = getSelectedFilePath(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        const fileName = require('path').basename(filePath);
        const fileDir = require('path').dirname(filePath);
        const command = `soscmd diff "${fileName}" -gui`;
        vscode.window.showInformationMessage(`Generating diff for ${fileName}...`);
        await executeCommand(command, fileDir);
        vscode.window.showInformationMessage(`Diff generated for ${fileName}`);
    }));
    if (isDebugEnabled()) {
        console.log('[DEBUG] Diff command registered');
    }
    // 注册Discard命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.discard', async (context) => {
        const filePath = getSelectedFilePath(context);
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
        await executeCommand(command, fileDir);
        vscode.window.showInformationMessage(`Successfully discarded changes for ${fileName}`);
    }));
    if (isDebugEnabled()) {
        console.log('[DEBUG] Discard command registered');
    }
    // 注册Office Open命令
    context.subscriptions.push(vscode.commands.registerCommand('cliosoft-sos-manager.officeOpen', async (context) => {
        const filePath = getSelectedFilePath(context);
        if (!filePath) {
            vscode.window.showErrorMessage('No file selected or active');
            return;
        }
        const command = `soffice "${filePath}" &`;
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Opening file in Office: ${filePath}`);
        }
        await executeCommand(command);
        vscode.window.showInformationMessage(`Opened file in Office: ${require('path').basename(filePath)}`);
    }));
    if (isDebugEnabled()) {
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
        await executeCommand(command);
        vscode.window.showInformationMessage('RTL compilation completed');
    }));
    if (isDebugEnabled()) {
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
        await executeCommand(command);
        vscode.window.showInformationMessage('Ctags rebuilt successfully');
    }));
    if (isDebugEnabled()) {
        console.log('[DEBUG] Rebuild Ctags command registered');
    }
    // 监听编辑器切换事件，自动刷新版本列表
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (isDebugEnabled()) {
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
    if (isDebugEnabled()) {
        console.log('[DEBUG] Editor change listener registered');
    }
    if (isDebugEnabled()) {
        console.log('[DEBUG] ClioSoft SOS Manager extension activated!');
        vscode.window.showInformationMessage('[DEBUG] ClioSoft SOS Manager extension activated!');
    }
    // 初始化文件状态装饰器
    fileStatusDecorator = new FileStatusDecorator();
    // 为当前打开的文件更新状态
    for (const editor of vscode.window.visibleTextEditors) {
        fileStatusDecorator.updateFileStatus(editor.document.uri.fsPath);
    }
    // 监听编辑器切换事件，更新状态
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            fileStatusDecorator.updateFileStatus(editor.document.uri.fsPath);
        }
    }));
    // 监听编辑器打开事件，更新状态
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
            fileStatusDecorator.updateFileStatus(editor.document.uri.fsPath);
        }
    }));
    // 监听文件保存事件，更新状态
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        fileStatusDecorator.updateFileStatus(document.uri.fsPath);
    }));
    // 监听文件打开事件
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        fileStatusDecorator.updateFileStatus(document.uri.fsPath);
    }));
    // 定期刷新所有打开文件的状态（每30秒）
    const statusRefreshInterval = setInterval(async () => {
        for (const editor of vscode.window.visibleTextEditors) {
            fileStatusDecorator.updateFileStatus(editor.document.uri.fsPath);
        }
    }, 30000);
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
        this.decorations = new Map();
        this.statusCache = new Map();
        this.debounceTimers = new Map();
        // 创建装饰类型（使用内置图标名称）
        this.checkoutDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: 'edit',
            gutterIconSize: 'contain'
        });
        this.checkedInDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: 'check',
            gutterIconSize: 'contain'
        });
        this.modifiedDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: 'diff-added',
            gutterIconSize: 'contain'
        });
        this.notLatestDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: 'warning',
            gutterIconSize: 'contain'
        });
    }
    // 更新单个文件的状态装饰
    async updateFileStatus(filePath) {
        // 跳过无效文件路径
        if (!filePath || typeof filePath !== 'string' || filePath.length === 0) {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Invalid filePath: ${filePath}`);
            }
            return;
        }
        // 跳过VSCode内部文件
        if (filePath.includes('sharedprocess') || filePath.includes('vscode-extension-host') || filePath.includes('file://') || !filePath.includes('/') && !filePath.includes(':')) {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Skipping VSCode internal file: ${filePath}`);
            }
            return;
        }
        // 防抖处理，避免频繁调用
        if (this.debounceTimers.has(filePath)) {
            clearTimeout(this.debounceTimers.get(filePath));
        }
        this.debounceTimers.set(filePath, setTimeout(async () => {
            try {
                // 检查文件是否存在
                const fs = require('fs');
                if (!fs.existsSync(filePath)) {
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] File not found: ${filePath}`);
                    }
                    // 清除装饰
                    this.clearDecorations(filePath);
                    return;
                }
                // 获取文件状态
                const status = await (0, soscmd_1.getFileStatus)(filePath);
                if (!status) {
                    // 清除装饰
                    this.clearDecorations(filePath);
                    return;
                }
                // 更新缓存
                this.statusCache.set(filePath, status);
                // 应用装饰
                this.applyDecorations(filePath, status);
            }
            catch (error) {
                if (isDebugEnabled()) {
                    console.error(`[ERROR] Failed to update file status for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            finally {
                // 清理定时器
                this.debounceTimers.delete(filePath);
            }
        }, 500));
    }
    // 应用装饰
    applyDecorations(filePath, status) {
        // 清除现有装饰
        this.clearDecorations(filePath);
        // 获取所有打开的编辑器
        const editors = vscode.window.visibleTextEditors;
        for (const editor of editors) {
            if (editor.document.uri.fsPath === filePath) {
                const decorations = [];
                // 根据状态添加装饰
                if (status.state === 'O' || status.state === 'W') {
                    decorations.push(this.checkoutDecoration);
                }
                else if (status.state === '-') {
                    decorations.push(this.checkedInDecoration);
                }
                if (status.change === 'M') {
                    decorations.push(this.modifiedDecoration);
                }
                if (status.newRevision === 'N') {
                    decorations.push(this.notLatestDecoration);
                }
                // 应用装饰
                for (const decoration of decorations) {
                    editor.setDecorations(decoration, [{ range: new vscode.Range(0, 0, 0, 0) }]);
                }
                // 保存装饰引用，以便后续清除
                this.decorations.set(filePath, decorations);
                break;
            }
        }
    }
    // 清除单个文件的装饰
    clearDecorations(filePath) {
        const decorations = this.decorations.get(filePath);
        if (decorations) {
            // 获取所有打开的编辑器
            const editors = vscode.window.visibleTextEditors;
            for (const editor of editors) {
                if (editor.document.uri.fsPath === filePath) {
                    for (const decoration of decorations) {
                        editor.setDecorations(decoration, []);
                    }
                    break;
                }
            }
            this.decorations.delete(filePath);
        }
    }
    // 批量更新文件夹下的所有文件状态
    async updateFolderStatus(folderPath) {
        try {
            // 获取文件夹下的所有文件
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folderPath));
            for (const [name, type] of files) {
                const itemPath = require('path').join(folderPath, name);
                if (type === vscode.FileType.File) {
                    // 更新文件状态
                    await this.updateFileStatus(itemPath);
                }
                else if (type === vscode.FileType.Directory) {
                    // 递归更新子文件夹
                    await this.updateFolderStatus(itemPath);
                }
            }
        }
        catch (error) {
            if (isDebugEnabled()) {
                console.error(`[ERROR] Failed to update folder status for ${folderPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    // 清理资源
    dispose() {
        // 清理所有定时器
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        // 清理所有装饰
        for (const filePath of this.decorations.keys()) {
            this.clearDecorations(filePath);
        }
        // 清理装饰类型
        this.checkoutDecoration.dispose();
        this.checkedInDecoration.dispose();
        this.modifiedDecoration.dispose();
        this.notLatestDecoration.dispose();
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