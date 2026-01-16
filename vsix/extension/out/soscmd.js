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
exports.getFileStatus = getFileStatus;
exports.switchFileVersion = switchFileVersion;
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
// 调试信息配置键
const DEBUG_INFO_CONFIG_KEY = 'cliosoft-sos-manager.enableDebugInfo';
// 获取调试开关状态
function isDebugEnabled() {
    return vscode.workspace.getConfiguration().get(DEBUG_INFO_CONFIG_KEY, false);
}
// 执行soscmd命令
function executeSoscmd(command, cwd, showError = true) {
    return new Promise((resolve, reject) => {
        // 输出详细的调试信息到扩展控制台（仅在调试模式下）
        if (isDebugEnabled()) {
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
            if (isDebugEnabled()) {
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
            if (isDebugEnabled()) {
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
        if (isDebugEnabled()) {
            console.log(`[DEBUG] getFileVersions called with filePath: ${filePath}`);
            vscode.window.showInformationMessage(`[DEBUG] getFileVersions: ${filePath}`);
        }
        // 获取文件所在目录作为工作目录
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        if (isDebugEnabled()) {
            console.log(`[DEBUG] File directory: ${fileDir}`);
            console.log(`[DEBUG] File name: ${fileName}`);
        }
        // 构建soscmd命令，查询文件版本
        const command = `soscmd history -fs "${fileName}"`;
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Building command: ${command}`);
        }
        const output = await executeSoscmd(command, fileDir);
        // 检查文件是否在sos管理下
        if (output.includes('@@ Error: Client: No valid objects selected for \'history\' operation.')) {
            // 文件不在sos管理下，返回空数组，不显示错误信息
            if (isDebugEnabled()) {
                console.log(`[DEBUG] File ${fileName} is not under SOS control`);
                vscode.window.showInformationMessage(`[DEBUG] File ${fileName} is not under SOS control`);
            }
            return [];
        }
        // 解析命令输出，格式化为FileVersion数组
        // 实际输出格式：Action: checkin | Revision: 1 | Rev ID: 5940 | By: haiming.yin | At time: 2026/01/12 15:46:39 | Checksum: 3850098212 | Size: 891 | Log: Initial revision.
        const versions = [];
        const lines = output.split('\n');
        if (isDebugEnabled()) {
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
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] Found version: ID=${id.trim()}, By=${ciBy.trim()}, Time=${ciTime.trim()}`);
                    }
                }
                else {
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] Line matched but failed to parse: ${line}`);
                        vscode.window.showWarningMessage(`[DEBUG] Failed to parse version line: ${line}`);
                    }
                }
            }
        }
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Found ${versions.length} versions`);
            vscode.window.showInformationMessage(`[DEBUG] Found ${versions.length} versions for ${fileName}`);
        }
        return versions;
    }
    catch (error) {
        // 详细的错误记录（仅在调试模式下记录堆栈跟踪）
        if (isDebugEnabled()) {
            console.error(`[ERROR] getFileVersions failed: ${error instanceof Error ? error.message : String(error)}`);
            console.error(`[ERROR] Stack trace: ${error instanceof Error ? error.stack : ''}`);
        }
        // 检查是否是文件不在sos管理下的错误
        if (error instanceof Error && error.message.includes('No valid objects selected for \'history\' operation')) {
            // 文件不在sos管理下，返回空数组，不显示错误信息
            if (isDebugEnabled()) {
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
// 获取文件状态
async function getFileStatus(filePath) {
    try {
        // 输出调试信息（仅在调试模式下）
        if (isDebugEnabled()) {
            console.log(`[DEBUG] getFileStatus called with filePath: ${filePath}`);
        }
        // 跳过VSCode内部文件和不存在的文件
        if (filePath.includes('sharedprocess') || filePath.includes('vscode-extension-host') || !filePath.startsWith('/') && !filePath.includes(':')) {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Skipping non-file: ${filePath}`);
            }
            return null;
        }
        // 检查文件是否存在
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] File not found: ${filePath}`);
            }
            return null;
        }
        // 获取文件所在目录作为工作目录
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        // 构建soscmd命令，获取文件状态
        const command = `soscmd status "${fileName}"`;
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Building status command: ${command}`);
        }
        // 调用executeSoscmd时不显示错误信息，因为文件可能不在SOS管理下
        const output = await executeSoscmd(command, fileDir, false);
        // 解析命令输出
        // 输出格式示例：f-----  2       ./design_data/testbench/digital_top/model/dpi/i2c_test/i2c_test.c
        // 状态码格式：T S C L N R V  (Type State Change Lock NewRevision RsoMatch Version)
        const lines = output.trim().split('\n');
        if (lines.length === 0) {
            return null;
        }
        // 找到包含状态信息的行
        const statusLine = lines.find(line => line.trim().length > 0);
        if (!statusLine) {
            return null;
        }
        // 检查是否是错误信息
        if (statusLine.includes('Error:')) {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Error in status output: ${statusLine}`);
            }
            return null;
        }
        // 输出原始状态行，便于调试
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Raw status line: ${statusLine}`);
        }
        // 解析状态行 - 更宽松的匹配模式
        const statusMatch = statusLine.match(/^(\w)(\w)(\w)(\w)(\w)(\w)\s+(\S+)\s+(.+)$/);
        if (!statusMatch) {
            // 尝试匹配另一种可能的格式 - 更宽松的匹配
            const altMatch = statusLine.match(/^(\w)(\w)(\w)(\w)(\w)(\w)(\w)?\s+(\S+)\s+(.+)$/);
            if (!altMatch) {
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] Failed to parse status line: ${statusLine}`);
                    console.log(`[DEBUG] Pattern 1: ${/^(\w)(\w)(\w)(\w)(\w)(\w)\s+(\S+)\s+(.+)$/.test(statusLine)}`);
                    console.log(`[DEBUG] Pattern 2: ${/^(\w)(\w)(\w)(\w)(\w)(\w)(\w)?\s+(\S+)\s+(.+)$/.test(statusLine)}`);
                }
                return null;
            }
            // 提取匹配组，处理可选的第7个字符
            const [, type, state, change, lock, newRevision, rsoMatch, optionalChar, version, fileStatusPath] = altMatch;
            return {
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
        }
        const [, type, state, change, lock, newRevision, rsoMatch, version, fileStatusPath] = statusMatch;
        // 构建FileStatus对象
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
        // 输出解析后的状态，便于调试
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Parsed status: ${JSON.stringify(fileStatus)}`);
        }
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Parsed file status: ${JSON.stringify(fileStatus)}`);
        }
        return fileStatus;
    }
    catch (error) {
        // 详细的错误记录（仅在调试模式下）
        if (isDebugEnabled()) {
            console.error(`[ERROR] getFileStatus failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
    }
}
// 切换文件版本
async function switchFileVersion(filePath, versionId) {
    try {
        // 输出调试信息（仅在调试模式下）
        if (isDebugEnabled()) {
            console.log(`[DEBUG] switchFileVersion called with filePath: ${filePath}, versionId: ${versionId}`);
            vscode.window.showInformationMessage(`[DEBUG] switchFileVersion: ${filePath} -> v${versionId}`);
        }
        // 获取文件所在目录作为工作目录
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        if (isDebugEnabled()) {
            console.log(`[DEBUG] File directory: ${fileDir}`);
            console.log(`[DEBUG] File name: ${fileName}`);
        }
        // 构建soscmd userev命令，切换文件版本
        const userevCommand = `soscmd userev "${fileName}/${versionId}"`;
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Building userev command: ${userevCommand}`);
        }
        try {
            // 尝试执行userev命令
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Attempting userev command...`);
            }
            await executeSoscmd(userevCommand, fileDir);
            vscode.window.showInformationMessage(`Successfully switched to version ${versionId}`);
            if (isDebugEnabled()) {
                console.log(`[DEBUG] userev command executed successfully`);
            }
        }
        catch (error) {
            // 详细记录错误（仅在调试模式下）
            if (isDebugEnabled()) {
                console.error(`[ERROR] userev failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            // 检查是否是文件已被checkout的错误
            if (error instanceof Error && error.message.includes('has been checked out. You must first check it in or cancel the checkout.')) {
                // 文件已被checkout，需要先执行discard命令，向用户确认
                const confirmMessage = `File ${fileName} is checked out. Do you want to discard changes and switch to version ${versionId}?`;
                if (isDebugEnabled()) {
                    console.log(`[DEBUG] File is checked out, asking user for confirmation...`);
                }
                // 显示确认对话框，提供Yes/No选项
                const confirmResult = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, 'Yes', 'No');
                if (confirmResult === 'Yes') {
                    // 用户确认执行discard操作
                    vscode.window.showWarningMessage(`Performing discard operation...`);
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] User confirmed discard operation`);
                    }
                    // 执行discard命令，取消checkout
                    const discardCommand = `soscmd discard -F "${fileName}"`;
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] Building discard command: ${discardCommand}`);
                    }
                    await executeSoscmd(discardCommand, fileDir);
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] discard command executed successfully`);
                    }
                    // 重新执行userev命令
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] Retrying userev command after discard...`);
                    }
                    await executeSoscmd(userevCommand, fileDir);
                    vscode.window.showInformationMessage(`Successfully switched to version ${versionId} after discard`);
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] userev command executed successfully after discard`);
                    }
                }
                else {
                    // 用户取消操作
                    if (isDebugEnabled()) {
                        console.log(`[DEBUG] User cancelled discard and version switch`);
                    }
                    vscode.window.showInformationMessage(`Version switch cancelled`);
                    return;
                }
            }
            else {
                // 其他错误，重新抛出
                if (isDebugEnabled()) {
                    console.error(`[ERROR] userev failed with non-checkout error, rethrowing...`);
                }
                throw error;
            }
        }
        // 刷新当前编辑器
        if (isDebugEnabled()) {
            console.log(`[DEBUG] Refreshing editor for ${filePath}`);
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Found active editor, updating content...`);
            }
            const fileUri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(content).toString();
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Read file content (${text.length} characters)`);
            }
            await activeEditor.edit(editBuilder => {
                const fullRange = new vscode.Range(activeEditor.document.positionAt(0), activeEditor.document.positionAt(activeEditor.document.getText().length));
                editBuilder.replace(fullRange, text);
            });
            if (isDebugEnabled()) {
                console.log(`[DEBUG] Editor content updated successfully`);
            }
        }
        else {
            if (isDebugEnabled()) {
                console.log(`[DEBUG] No active editor found for ${filePath}`);
            }
        }
        if (isDebugEnabled()) {
            console.log(`[DEBUG] switchFileVersion completed successfully`);
        }
    }
    catch (error) {
        // 详细的错误记录（仅在调试模式下记录堆栈跟踪）
        const errorMsg = `Failed to switch version: ${error instanceof Error ? error.message : String(error)}`;
        if (isDebugEnabled()) {
            console.error(`[ERROR] switchFileVersion failed: ${errorMsg}`);
            console.error(`[ERROR] Stack trace: ${error instanceof Error ? error.stack : ''}`);
        }
        vscode.window.showErrorMessage(errorMsg);
    }
}
//# sourceMappingURL=soscmd.js.map