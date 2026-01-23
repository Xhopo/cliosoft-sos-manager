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
exports.executeSoscmd = executeSoscmd;
exports.getFileVersions = getFileVersions;
exports.parseStatusLine = parseStatusLine;
exports.getFileStatus = getFileStatus;
exports.getFolderStatus = getFolderStatus;
exports.switchFileVersion = switchFileVersion;
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const utils_1 = require("./utils");
// 执行soscmd命令
function executeSoscmd(command, cwd, showError = true) {
    return new Promise((resolve, reject) => {
        // 输出详细的调试信息到扩展控制台（仅在调试模式下）
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Executing soscmd: ${command}`);
            if (cwd) {
                console.log(`[DEBUG] Working directory: ${cwd}`);
            }
            // 也显示给用户
            vscode.window.showInformationMessage(`[DEBUG] Executing: ${command}${cwd ? ` (cwd: ${cwd})` : ''}`);
        }
        // 使用文件所在目录作为工作目录，确保soscmd能正确找到文件
        (0, child_process_1.exec)(command, { cwd }, (error, stdout, stderr) => {
            let errorMessage = '';
            // 记录命令输出到扩展控制台（仅在调试模式下）
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Command stdout: ${stdout}`);
                if (stderr) {
                    console.log(`[DEBUG] Command stderr: ${stderr}`);
                }
            }
            if (error) {
                errorMessage = `soscmd execution failed: ${error.message}`;
                // 添加更详细的调试信息
                if (cwd) {
                    errorMessage += ` (Working directory: ${cwd})`;
                }
                errorMessage += `\nCommand: ${command}`;
                errorMessage += `\nstdout: ${stdout}`;
                errorMessage += `\nstderr: ${stderr}`;
                // 只在showError为true时显示错误信息
                if (showError) {
                    console.error(`[ERROR] ${errorMessage}`);
                    vscode.window.showErrorMessage(errorMessage);
                }
                else {
                    console.log(`[DEBUG] Command failed (suppressed): ${command}`);
                }
                reject(new Error(errorMessage));
                return;
            }
            if (stderr) {
                // 有些soscmd命令可能会在stderr中输出警告信息，但仍然执行成功
                console.log(`[WARNING] Command completed with stderr: ${stderr}`);
            }
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Command executed successfully`);
            }
            resolve(stdout);
        });
    });
}
// 查询文件版本
async function getFileVersions(filePath) {
    try {
        // 输出调试信息（仅在调试模式下）
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] getFileVersions called with filePath: ${filePath}`);
            vscode.window.showInformationMessage(`[DEBUG] getFileVersions: ${filePath}`);
        }
        // 获取文件所在目录作为工作目录
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] File directory: ${fileDir}`);
            console.log(`[DEBUG] File name: ${fileName}`);
        }
        // 构建soscmd命令，查询文件版本
        const command = `soscmd history -fs "${filePath}"`;
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Building command: ${command}`);
        }
        const output = await executeSoscmd(command, fileDir);
        // 检查文件是否在sos管理下
        if (output.includes('@@ Error: Client: No valid objects selected for \'history\' operation.')) {
            // 文件不在sos管理下，返回空数组，不显示错误信息
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] File ${fileName} is not under SOS control`);
                vscode.window.showInformationMessage(`[DEBUG] File ${fileName} is not under SOS control`);
            }
            return [];
        }
        // 解析命令输出，格式化为FileVersion数组
        // 实际输出格式：Action: checkin | Revision: 1 | Rev ID: 5940 | By: haiming.yin | At time: 2026/01/12 15:46:39 | Checksum: 3850098212 | Size: 891 | Log: Initial revision.
        const versions = [];
        const lines = output.split('\n');
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Output lines count: ${lines.length}`);
            console.log(`[DEBUG] Raw output: ${output}`);
        }
        // 查找包含"Action: checkin"的行，这些行包含版本信息
        for (const line of lines) {
            if (line.trim().startsWith('Action: checkin')) {
                // 解析版本行，提取Revision、By、At time和Log字段
                const versionMatch = line.match(/Revision: (\d+) \|.*?By: (.*?) \| At time: (\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \|.*?Log: (.*)$/);
                if (versionMatch) {
                    const [, id, ciBy, ciTime, changeSummary] = versionMatch;
                    versions.push({
                        id: id.trim(),
                        ciBy: ciBy.trim(),
                        ciTime: ciTime.trim(),
                        changeSummary: changeSummary.trim()
                    });
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.log(`[DEBUG] Found version: ID=${id.trim()}, By=${ciBy.trim()}, Time=${ciTime.trim()}`);
                    }
                }
                else {
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.log(`[DEBUG] Line matched but failed to parse: ${line}`);
                        vscode.window.showWarningMessage(`[DEBUG] Failed to parse version line: ${line}`);
                    }
                }
            }
        }
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Found ${versions.length} versions`);
            vscode.window.showInformationMessage(`[DEBUG] Found ${versions.length} versions for ${fileName}`);
        }
        return versions;
    }
    catch (error) {
        // 详细的错误记录（仅在调试模式下记录堆栈跟踪）
        if ((0, utils_1.isDebugEnabled)()) {
            console.error(`[ERROR] getFileVersions failed: ${error instanceof Error ? error.message : String(error)}`);
            console.error(`[ERROR] Stack trace: ${error instanceof Error ? error.stack : ''}`);
        }
        // 检查是否是文件不在sos管理下的错误
        if (error instanceof Error && error.message.includes('No valid objects selected for \'history\' operation')) {
            // 文件不在sos管理下，返回空数组，不显示错误信息
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] File is not under SOS control (from error)`);
            }
            return [];
        }
        // 其他错误，显示错误信息
        const errorMsg = `Failed to get file versions: ${error instanceof Error ? error.message : String(error)}`;
        vscode.window.showErrorMessage(errorMsg);
        return [];
    }
}
// 解析单个状态行
function parseStatusLine(statusLine) {
    // 输出原始状态行，便于调试
    if ((0, utils_1.isDebugEnabled)()) {
        console.log(`[DEBUG] Parsing status line: ${statusLine}`);
    }
    // 尝试将制表符替换为空格，便于正则表达式匹配
    const normalizedLine = statusLine.replace(/\t/g, ' ');
    // 首先尝试匹配标准格式: 状态码(6字符) + 空格 + 版本号(数字) + 空格 + 路径
    const statusMatch = normalizedLine.match(/^([fpdFsS])([-OWXN?])([-M!?-])([-L?-])([-N?-])([-R?])\s+(\d+)\s+(.+)$/);
    if (statusMatch) {
        const [, type, state, change, lock, newRevision, rsoMatch, version, fileStatusPath] = statusMatch;
        const fileStatus = {
            type,
            state,
            change,
            lock,
            newRevision,
            revision: version,
            path: fileStatusPath,
            author: '',
            time: '',
            log: ''
        };
        return fileStatus;
    }
    // 尝试匹配包含版本号的状态码格式（如7字符：状态码+RsoMatch+Version）
    const statusMatchWithVersion = normalizedLine.match(/^([fpdFsS])([-OWXN?])([-M!?-])([-L?-])([-N?-])([-R?])\s+(\S+)\s+(.+)$/);
    if (statusMatchWithVersion) {
        const [, type, state, change, lock, newRevision, rsoMatch, version, fileStatusPath] = statusMatchWithVersion;
        const fileStatus = {
            type,
            state,
            change,
            lock,
            newRevision,
            revision: version,
            path: fileStatusPath,
            author: '',
            time: '',
            log: ''
        };
        return fileStatus;
    }
    // 最后尝试更宽松的匹配，使用\s*匹配任意数量的空白字符
    const relaxedMatch = normalizedLine.match(/^([fpdFsS])([-OWXN?])([-M!?-])([-L?-])([-N?-])([-R?])\s*(\S+)\s*(.+)$/);
    if (relaxedMatch) {
        const [, type, state, change, lock, newRevision, rsoMatch, version, fileStatusPath] = relaxedMatch;
        const fileStatus = {
            type,
            state,
            change,
            lock,
            newRevision,
            revision: version,
            path: fileStatusPath,
            author: '',
            time: '',
            log: ''
        };
        return fileStatus;
    }
    // 尝试最简单的匹配：前6个字符是状态码，然后是版本号，然后是路径
    const simpleMatch = normalizedLine.match(/^(.{6})\s*(\S+)\s*(.+)$/);
    if (simpleMatch) {
        const [, statusCode, version, fileStatusPath] = simpleMatch;
        // 解析状态码
        const type = statusCode[0] || '-';
        const state = statusCode[1] || '-';
        const change = statusCode[2] || '-';
        const lock = statusCode[3] || '-';
        const newRevision = statusCode[4] || '-';
        const rsoMatch = statusCode[5] || '-';
        const fileStatus = {
            type,
            state,
            change,
            lock,
            newRevision,
            revision: version,
            path: fileStatusPath,
            author: '',
            time: '',
            log: ''
        };
        return fileStatus;
    }
    // 如果所有匹配都失败，打印详细信息
    if ((0, utils_1.isDebugEnabled)()) {
        console.log(`[DEBUG] Failed to parse status line: "${statusLine}"`);
    }
    return null;
}
// 获取单个文件状态
async function getFileStatus(filePath) {
    try {
        // 输出调试信息（仅在调试模式下）
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] getFileStatus called with filePath: ${filePath}`);
        }
        // 跳过VSCode内部文件和不存在的文件
        if (filePath.includes('sharedprocess') || filePath.includes('vscode-extension-host') || !filePath.includes('/') && !filePath.includes(':')) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Skipping non-file: ${filePath}`);
            }
            return null;
        }
        // 检查文件是否存在
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] File not found: ${filePath}`);
            }
            return null;
        }
        // 获取文件所在目录作为工作目录，使用相对路径调用soscmd status
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const command = `soscmd status ${fileName}`;
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Building status command: ${command}`);
            console.log(`[DEBUG] Working directory: ${fileDir}`);
        }
        // 调用executeSoscmd时不显示错误信息，因为文件可能不在SOS管理下
        const output = await executeSoscmd(command, fileDir, false);
        // 解析命令输出
        const lines = output.trim().split('\n');
        if (lines.length === 0) {
            return null;
        }
        // 找到包含状态信息的行
        const statusLine = lines.find(line => line.trim().length > 0 && !line.includes('@@ Error'));
        if (!statusLine) {
            return null;
        }
        // 检查是否是错误信息
        if (statusLine.includes('Error:')) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Error in status output: ${statusLine}`);
            }
            return null;
        }
        // 解析状态行
        return parseStatusLine(statusLine);
    }
    catch (error) {
        // 详细的错误记录（仅在调试模式下）
        if ((0, utils_1.isDebugEnabled)()) {
            console.error(`[ERROR] getFileStatus failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
    }
}
// 获取文件夹下所有文件的状态
async function getFolderStatus(folderPath) {
    const statusMap = new Map();
    try {
        // 输出调试信息（仅在调试模式下）
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] getFolderStatus called with folderPath: ${folderPath}`);
        }
        // 检查文件夹是否存在
        const fs = require('fs');
        if (!fs.existsSync(folderPath)) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Folder not found: ${folderPath}`);
            }
            return statusMap;
        }
        // 使用soscmd status folderPath/*获取整个文件夹的状态
        const command = `soscmd status ${folderPath}/*`;
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Building folder status command: ${command}`);
            console.log(`[DEBUG] Working directory: ${folderPath}`);
        }
        // 调用executeSoscmd时不显示错误信息
        const output = await executeSoscmd(command, folderPath, false);
        // 解析命令输出
        const lines = output.trim().split('\n');
        for (const line of lines) {
            if (line.trim().length === 0 || line.includes('@@ Error')) {
                continue;
            }
            // 检查是否是错误信息
            if (line.includes('Error:')) {
                if ((0, utils_1.isDebugEnabled)()) {
                    console.log(`[DEBUG] Error in folder status output: ${line}`);
                }
                continue;
            }
            // 解析状态行
            const status = parseStatusLine(line);
            if (status) {
                // 获取文件名
                const fileName = path.basename(status.path);
                // 构建完整文件路径
                const fullPath = path.join(folderPath, fileName);
                statusMap.set(fullPath, status);
            }
        }
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] getFolderStatus returned ${statusMap.size} statuses`);
        }
    }
    catch (error) {
        // 详细的错误记录（仅在调试模式下）
        if ((0, utils_1.isDebugEnabled)()) {
            console.error(`[ERROR] getFolderStatus failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return statusMap;
}
// 切换文件版本
async function switchFileVersion(filePath, versionId) {
    try {
        // 输出调试信息（仅在调试模式下）
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] switchFileVersion called with filePath: ${filePath}, versionId: ${versionId}`);
            vscode.window.showInformationMessage(`[DEBUG] switchFileVersion: ${filePath} -> v${versionId}`);
        }
        // 获取文件所在目录作为工作目录
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] File directory: ${fileDir}`);
            console.log(`[DEBUG] File name: ${fileName}`);
        }
        // 构建soscmd userev命令，切换文件版本
        const userevCommand = `soscmd userev "${filePath}/${versionId}"`;
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Building userev command: ${userevCommand}`);
        }
        try {
            // 尝试执行userev命令
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Attempting userev command...`);
            }
            await executeSoscmd(userevCommand, fileDir);
            vscode.window.showInformationMessage(`Successfully switched to version ${versionId}`);
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] userev command executed successfully`);
            }
        }
        catch (error) {
            // 详细记录错误（仅在调试模式下）
            if ((0, utils_1.isDebugEnabled)()) {
                console.error(`[ERROR] userev failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            // 检查是否是文件已被checkout的错误
            if (error instanceof Error && error.message.includes('has been checked out. You must first check it in or cancel the checkout.')) {
                // 文件已被checkout，需要先执行discard命令，向用户确认
                const confirmMessage = `File ${fileName} is checked out. Do you want to discard changes and switch to version ${versionId}?`;
                if ((0, utils_1.isDebugEnabled)()) {
                    console.log(`[DEBUG] File is checked out, asking user for confirmation...`);
                }
                // 显示确认对话框，提供Yes/No选项
                const confirmResult = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, 'Yes', 'No');
                if (confirmResult === 'Yes') {
                    // 用户确认执行discard操作
                    vscode.window.showWarningMessage(`Performing discard operation...`);
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.log(`[DEBUG] User confirmed discard operation`);
                    }
                    // 执行discard命令，取消checkout
                    const discardCommand = `soscmd discard -F "${filePath}"`;
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.log(`[DEBUG] Building discard command: ${discardCommand}`);
                    }
                    await executeSoscmd(discardCommand, fileDir);
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.log(`[DEBUG] discard command executed successfully`);
                    }
                    // 重新执行userev命令
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.log(`[DEBUG] Retrying userev command after discard...`);
                    }
                    await executeSoscmd(userevCommand, fileDir);
                    vscode.window.showInformationMessage(`Successfully switched to version ${versionId} after discard`);
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.log(`[DEBUG] userev command executed successfully after discard`);
                    }
                }
                else {
                    // 用户取消操作
                    if ((0, utils_1.isDebugEnabled)()) {
                        console.log(`[DEBUG] User cancelled discard and version switch`);
                    }
                    vscode.window.showInformationMessage(`Version switch cancelled`);
                    return;
                }
            }
            else {
                // 其他错误，重新抛出
                if ((0, utils_1.isDebugEnabled)()) {
                    console.error(`[ERROR] userev failed with non-checkout error, rethrowing...`);
                }
                throw error;
            }
        }
        // 刷新当前编辑器
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] Refreshing editor for ${filePath}`);
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Found active editor, updating content...`);
            }
            const fileUri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(content).toString();
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Read file content (${text.length} characters)`);
            }
            await activeEditor.edit(editBuilder => {
                const fullRange = new vscode.Range(activeEditor.document.positionAt(0), activeEditor.document.positionAt(activeEditor.document.getText().length));
                editBuilder.replace(fullRange, text);
            });
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] Editor content updated successfully`);
            }
        }
        else {
            if ((0, utils_1.isDebugEnabled)()) {
                console.log(`[DEBUG] No active editor found for ${filePath}`);
            }
        }
        if ((0, utils_1.isDebugEnabled)()) {
            console.log(`[DEBUG] switchFileVersion completed successfully`);
        }
    }
    catch (error) {
        // 详细的错误记录（仅在调试模式下记录堆栈跟踪）
        const errorMsg = `Failed to switch version: ${error instanceof Error ? error.message : String(error)}`;
        if ((0, utils_1.isDebugEnabled)()) {
            console.error(`[ERROR] switchFileVersion failed: ${errorMsg}`);
            console.error(`[ERROR] Stack trace: ${error instanceof Error ? error.stack : ''}`);
        }
        vscode.window.showErrorMessage(errorMsg);
    }
}
//# sourceMappingURL=soscmd.js.map