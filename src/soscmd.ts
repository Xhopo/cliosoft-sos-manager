import { exec, spawn } from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import { isDebugEnabled, logDebug, logError } from './utils';

// 定义文件版本接口
export interface FileVersion {
    id: string;
    ciBy: string;
    ciTime: string;
    changeSummary: string;
}

// 定义文件状态接口
export interface FileStatus {
    type: string;      // 文件类型: f->file, d->directory等
    state: string;     // 状态: O->checked out, -->checked in, W->checked out without lock等
    change: string;    // 更改状态: M->modified, !->deleted, -->not modified
    lock: string;      // 锁定状态: L->locked, -->not locked
    newRevision: string; // 是否有新版本: N->not latest, -->latest
    revision: string;  // 版本号
    path: string;      // 文件路径
    author: string;    // 作者
    time: string;      // 时间
    log: string;       // 日志
}

/**
 * Convert technical SOS error messages to user-friendly descriptions
 */
function getUserFriendlyError(output: string, command?: string): string {
    if (!output) {
        return 'Unknown error occurred';
    }

    // Common error patterns
    if (output.includes('No valid objects selected')) {
        return 'File is not under SOS version control';
    }
    if (output.includes('has been checked out')) {
        return 'File is already checked out. Please check it in or discard changes first';
    }
    if (output.includes('Permission denied') || output.includes('Access denied')) {
        return 'Permission denied. Please check your access rights';
    }
    if (output.includes('not found') || output.includes('does not exist')) {
        return 'File or resource not found';
    }
    if (output.includes('locked by another user')) {
        return 'File is locked by another user';
    }
    if (output.includes('network') || output.includes('connection')) {
        return 'Network connection error. Please check your connection to the SOS server';
    }

    // Extract first meaningful error line
    const lines = output.split('\n').filter(line =>
        line.trim().length > 0 &&
        (line.includes('Error') || line.includes('error') || line.includes('failed'))
    );

    if (lines.length > 0) {
        return lines[0].trim();
    }

    return 'Operation failed. Check output channel for details';
}


// 执行soscmd命令
export function executeSoscmd(command: string, cwd?: string, showError?: boolean): Promise<string>;
export function executeSoscmd(args: string[], cwd?: string, showError?: boolean): Promise<string>;
export function executeSoscmd(commandOrArgs: string | string[], cwd?: string, showError: boolean = true): Promise<string> {
    return new Promise((resolve, reject) => {
        if (Array.isArray(commandOrArgs)) {
            // 使用spawn方式执行命令
            if (isDebugEnabled()) {
                logDebug(`Executing soscmd with spawn: ${commandOrArgs.join(' ')}`);
                if (cwd) {
                    logDebug(`Working directory: ${cwd}`);
                }
                vscode.window.showInformationMessage(`[DEBUG] Executing: soscmd ${commandOrArgs.join(' ')}${cwd ? ` (cwd: ${cwd})` : ''}`);
            }
            
            const proc = spawn('soscmd', commandOrArgs, { cwd, shell: true });
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
                if (isDebugEnabled()) {
                    logDebug(`stdout chunk: ${data.toString()}`);
                }
            });
            
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
                if (isDebugEnabled()) {
                    logDebug(`stderr chunk: ${data.toString()}`);
                }
            });
            
            proc.on('close', (code) => {
                if (isDebugEnabled()) {
                    logDebug(`Process exited with code: ${code}`);
                    logDebug(`Full stdout: ${stdout}`);
                    if (stderr) {
                        logDebug(`Full stderr: ${stderr}`);
                    }
                }
                if (code !== 0) {
                    const userFriendlyError = getUserFriendlyError(stderr || stdout, commandOrArgs[0]);
                    const errorMessage = `SOS command failed: ${userFriendlyError}`;

                    if (showError) {
                        logError(`Command: soscmd ${commandOrArgs.join(' ')}\nExit code: ${code}\nOutput: ${stdout}\nError: ${stderr}`);
                        vscode.window.showErrorMessage(errorMessage);
                    } else {
                        logDebug(`Command failed (suppressed): soscmd ${commandOrArgs.join(' ')}`);
                    }
                    reject(new Error(errorMessage));
                    return;
                }

                if (stderr && isDebugEnabled()) {
                    logDebug(`Command completed with stderr: ${stderr}`);
                }
                
                if (isDebugEnabled()) {
                    logDebug(`Command executed successfully`);
                }
                resolve(stdout);
            });

            proc.on('error', (error) => {
                const errorMessage = `Failed to execute soscmd: ${error.message}`;
                if (showError) {
                    logError(errorMessage);
                    vscode.window.showErrorMessage(errorMessage);
                } else {
                    logDebug(`Spawn error (suppressed): ${error.message}`);
                }
                reject(new Error(errorMessage));
            });
        } else {
            // 使用exec方式执行命令
            const command = commandOrArgs;
            if (isDebugEnabled()) {
                logDebug(`Executing soscmd: ${command}`);
                if (cwd) {
                    logDebug(`Working directory: ${cwd}`);
                }
                vscode.window.showInformationMessage(`[DEBUG] Executing: ${command}${cwd ? ` (cwd: ${cwd})` : ''}`);
            }
            
            exec(command, { cwd }, (error, stdout, stderr) => {
                let errorMessage = '';
                
                if (isDebugEnabled()) {
                    logDebug(`Command stdout: ${stdout}`);
                    if (stderr) {
                        logDebug(`Command stderr: ${stderr}`);
                    }
                }
                
                if (error) {
                    const userFriendlyError = getUserFriendlyError(stderr || stdout, command.split(' ')[1]);
                    errorMessage = `SOS command failed: ${userFriendlyError}`;

                    if (showError) {
                        logError(`Command: ${command}\nWorking directory: ${cwd || 'N/A'}\nOutput: ${stdout}\nError: ${stderr}`);
                        vscode.window.showErrorMessage(errorMessage);
                    } else {
                        logDebug(`Command failed (suppressed): ${command}`);
                    }
                    reject(new Error(errorMessage));
                    return;
                }

                if (stderr && isDebugEnabled()) {
                    logDebug(`Command completed with stderr: ${stderr}`);
                }
                
                if (isDebugEnabled()) {
                    logDebug(`Command executed successfully`);
                }
                resolve(stdout);
            });
        }
    });
}

// 查询文件版本
export async function getFileVersions(filePath: string): Promise<FileVersion[]> {
    try {
        // 输出调试信息（仅在调试模式下）
        if (isDebugEnabled()) {
            logDebug(`getFileVersions called with filePath: ${filePath}`);
            vscode.window.showInformationMessage(`[DEBUG] getFileVersions: ${filePath}`);
        }
        
        // 获取文件所在目录作为工作目录
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        
        if (isDebugEnabled()) {
            logDebug(`File directory: ${fileDir}`);
            logDebug(`File name: ${fileName}`);
        }
        
        // 构建soscmd命令，查询文件版本
        const command = `soscmd history -fs "${filePath}"`;
        
        if (isDebugEnabled()) {
            logDebug(`Building command: ${command}`);
        }
        
        const output = await executeSoscmd(command, fileDir, false);
        
        // 检查文件是否在sos管理下
        if (output.includes('@@ Error: Client: No valid objects selected for \'history\' operation.')) {
            // 文件不在sos管理下，返回空数组，不显示错误信息
            if (isDebugEnabled()) {
                logDebug(`File ${fileName} is not under SOS control`);
                vscode.window.showInformationMessage(`[DEBUG] File ${fileName} is not under SOS control`);
            }
            return [];
        }
        
        // 解析命令输出，格式化为FileVersion数组
        // 实际输出格式：Action: checkin | Revision: 1 | Rev ID: 5940 | By: haiming.yin | At time: 2026/01/12 15:46:39 | Checksum: 3850098212 | Size: 891 | Log: Initial revision.
        const versions: FileVersion[] = [];
        const lines = output.split('\n');

        if (isDebugEnabled()) {
            logDebug(`Output lines count: ${lines.length}`);
            logDebug(`Raw output: ${output}`);
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
                        logDebug(`Found version: ID=${id.trim()}, By=${ciBy.trim()}, Time=${ciTime.trim()}`);
                    }
                } else if (isDebugEnabled()) {
                    logDebug(`Line matched but failed to parse: ${line}`);
                }
            }
        }
        
        if (isDebugEnabled()) {
            logDebug(`Found ${versions.length} versions`);
            vscode.window.showInformationMessage(`[DEBUG] Found ${versions.length} versions for ${fileName}`);
        }
        return versions;
    } catch (error) {
        // 详细的错误记录（仅在调试模式下记录堆栈跟踪）
        if (isDebugEnabled()) {
            logError(`getFileVersions failed: ${error instanceof Error ? error.message : String(error)}`);
            logError(`Stack trace: ${error instanceof Error ? error.stack : ''}`);
        }
        
        // 检查是否是文件不在sos管理下的错误
        if (error instanceof Error && error.message.includes('No valid objects selected for \'history\' operation')) {
            // 文件不在sos管理下，返回空数组，不显示错误信息
            if (isDebugEnabled()) {
                logDebug(`File is not under SOS control (from error)`);
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
export function parseStatusLine(statusLine: string): FileStatus | null {
    // 输出原始状态行，便于调试
    if (isDebugEnabled()) {
        logDebug(`Parsing status line: ${statusLine}`);
    }

    // 尝试将制表符替换为空格，便于正则表达式匹配
    const normalizedLine = statusLine.replace(/\t/g, ' ');

    // 首先尝试匹配标准格式: 状态码(6字符) + 空格 + 版本号(数字) + 空格 + 路径
    const statusMatch = normalizedLine.match(/^([fpdFsS])([-OWXN?])([-M!?-])([-L?-])([-N?-])([-R?])\s+(\d+)\s+(.+)$/);
    if (statusMatch) {
        const [, type, state, change, lock, newRevision, rsoMatch, version, fileStatusPath] = statusMatch;
        const fileStatus: FileStatus = {
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
        const fileStatus: FileStatus = {
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
        const fileStatus: FileStatus = {
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

        const fileStatus: FileStatus = {
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

    // 最终降级处理：按空格分割，启发式匹配
    const parts = normalizedLine.trim().split(/\s+/);
    if (parts.length >= 2) {
        if (isDebugEnabled()) {
            logDebug(`Using fallback parsing with ${parts.length} parts: ${parts.join('|')}`);
        }

        // 假设前6个字符是状态码，后面是版本号和路径
        const statusCode = parts[0].padEnd(6, '-');
        const version = parts[1];
        const filePath = parts.slice(2).join(' ');

        const fileStatus: FileStatus = {
            type: statusCode[0] || '-',
            state: statusCode[1] || '-',
            change: statusCode[2] || '-',
            lock: statusCode[3] || '-',
            newRevision: statusCode[4] || '-',
            revision: version,
            path: filePath,
            author: '',
            time: '',
            log: ''
        };

        if (isDebugEnabled()) {
            logDebug(`Fallback parsing result: ${JSON.stringify(fileStatus)}`);
        }

        return fileStatus;
    }

    // 如果所有匹配都失败，打印详细信息
    if (isDebugEnabled()) {
        logDebug(`Failed to parse status line: "${statusLine}"`);
    }
    return null;
}

// 获取单个文件状态
export async function getFileStatus(filePath: string): Promise<FileStatus | null> {
    try {
        // 输出调试信息（仅在调试模式下）
        if (isDebugEnabled()) {
            logDebug(`getFileStatus called with filePath: ${filePath}`);
        }
        
        // 跳过VSCode内部文件和不存在的文件
        if (filePath.includes('sharedprocess') || filePath.includes('vscode-extension-host') || !filePath.includes('/') && !filePath.includes(':')) {
            if (isDebugEnabled()) {
                logDebug(`Skipping non-file: ${filePath}`);
            }
            return null;
        }
        
        // 检查文件是否存在
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            if (isDebugEnabled()) {
                logDebug(`File not found: ${filePath}`);
            }
            return null;
        }
        
        // 获取文件所在目录作为工作目录，使用相对路径调用soscmd status
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const command = `soscmd status ${fileName}`;
        
        if (isDebugEnabled()) {
            logDebug(`Building status command: ${command}`);
            logDebug(`Working directory: ${fileDir}`);
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
            if (isDebugEnabled()) {
                logDebug(`Error in status output: ${statusLine}`);
            }
            return null;
        }
        
        // 解析状态行
        return parseStatusLine(statusLine);
    } catch (error) {
        // 详细的错误记录（仅在调试模式下）
        if (isDebugEnabled()) {
            logError(`getFileStatus failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
    }
}

// 获取文件夹下所有文件的状态
export async function getFolderStatus(folderPath: string): Promise<Map<string, FileStatus>> {
    const statusMap = new Map<string, FileStatus>();
    
    try {
        // 输出调试信息（仅在调试模式下）
        if (isDebugEnabled()) {
            logDebug(`getFolderStatus called with folderPath: ${folderPath}`);
        }
        
        // 检查文件夹是否存在
        const fs = require('fs');
        if (!fs.existsSync(folderPath)) {
            if (isDebugEnabled()) {
                logDebug(`Folder not found: ${folderPath}`);
            }
            return statusMap;
        }
        
        // 使用soscmd status folderPath/*获取整个文件夹的状态
        const command = `soscmd status ${folderPath}/*`;
        
        if (isDebugEnabled()) {
            logDebug(`Building folder status command: ${command}`);
            logDebug(`Working directory: ${folderPath}`);
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
                if (isDebugEnabled()) {
                    logDebug(`Error in folder status output: ${line}`);
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
        
        if (isDebugEnabled()) {
            logDebug(`getFolderStatus returned ${statusMap.size} statuses`);
        }
    } catch (error) {
        // 详细的错误记录（仅在调试模式下）
        if (isDebugEnabled()) {
            logError(`getFolderStatus failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    return statusMap;
}

/**
 * 递归扫描文件夹，获取所有子文件夹的 SOS 状态
 * @param folderPath 起始文件夹
 * @param onFolderScanned 每扫描完一个文件夹的回调，用于增量更新缓存
 * @param cancellationToken 取消令牌
 */
export async function getRecursiveFolderStatus(
    folderPath: string,
    onFolderScanned: (folderPath: string, statusMap: Map<string, FileStatus>) => void,
    cancellationToken?: vscode.CancellationToken
): Promise<void> {
    const fs = require('fs');

    if (cancellationToken?.isCancellationRequested) { return; }

    // 获取当前文件夹的直接子项状态
    let statusMap: Map<string, FileStatus>;
    try {
        statusMap = await getFolderStatus(folderPath);
    } catch {
        return;
    }
    onFolderScanned(folderPath, statusMap);

    // 收集子目录：从 soscmd 结果中找 type='d' 的，以及从文件系统中发现的目录
    const subdirs = new Set<string>();

    statusMap.forEach((status, filePath) => {
        if (status.type === 'd') {
            subdirs.add(filePath);
        }
    });

    try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                subdirs.add(path.join(folderPath, entry.name));
            }
        }
    } catch { /* ignore permission errors */ }

    // 递归扫描子目录，并发限制 3 个
    const SCAN_CONCURRENCY = 3;
    const dirs = Array.from(subdirs);
    for (let i = 0; i < dirs.length; i += SCAN_CONCURRENCY) {
        if (cancellationToken?.isCancellationRequested) { return; }
        const batch = dirs.slice(i, i + SCAN_CONCURRENCY);
        await Promise.all(batch.map(dir =>
            getRecursiveFolderStatus(dir, onFolderScanned, cancellationToken)
        ));
    }
}

/**
 * 一次性获取工作区中所有"值得关注"的文件状态（checked out / modified / missing / needs update）。
 * 利用 soscmd select 参数递归扫描，替代逐文件夹调用。
 */
export async function getInterestingStatus(
    workspaceRoot: string,
    cancellationToken?: vscode.CancellationToken
): Promise<Map<string, FileStatus>> {
    const statusMap = new Map<string, FileStatus>();

    if (cancellationToken?.isCancellationRequested) { return statusMap; }

    try {
        // -sco: checked out, -suco: checked out without lock,
        // -sncm: not checked out but modified, -sne: missing, -snt: needs update
        // status 命令默认 OR 模式，select 参数自带递归
        const output = await executeSoscmd(
            ['status', '*', '-sco', '-suco', '-sncm', '-sne', '-snt'],
            workspaceRoot,
            false
        );

        if (cancellationToken?.isCancellationRequested) { return statusMap; }

        const lines = output.trim().split('\n');
        for (const line of lines) {
            if (line.trim().length === 0 || line.includes('@@ Error') || line.includes('Error:')) {
                continue;
            }

            const status = parseStatusLine(line);
            if (!status) { continue; }

            // 输出路径是相对路径（如 ./design_data/xxx），转为绝对路径
            let filePath = status.path;
            if (filePath.startsWith('./')) {
                filePath = path.join(workspaceRoot, filePath.substring(2));
            } else if (!path.isAbsolute(filePath)) {
                filePath = path.join(workspaceRoot, filePath);
            }

            statusMap.set(filePath, { ...status, path: filePath });
        }

        if (isDebugEnabled()) {
            logDebug(`getInterestingStatus: found ${statusMap.size} interesting files`);
        }
    } catch (error) {
        if (isDebugEnabled()) {
            logError(`getInterestingStatus failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return statusMap;
}

// 切换文件版本
export async function switchFileVersion(filePath: string, versionId: string): Promise<void> {
    try {
        // 输出调试信息（仅在调试模式下）
        if (isDebugEnabled()) {
            logDebug(`switchFileVersion called with filePath: ${filePath}, versionId: ${versionId}`);
            vscode.window.showInformationMessage(`[DEBUG] switchFileVersion: ${filePath} -> v${versionId}`);
        }
        
        // 获取文件所在目录作为工作目录
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        
        if (isDebugEnabled()) {
            logDebug(`File directory: ${fileDir}`);
            logDebug(`File name: ${fileName}`);
        }
        
        // 构建soscmd userev命令，切换文件版本
        const userevCommand = `soscmd userev "${filePath}/${versionId}"`;

        if (isDebugEnabled()) {
            logDebug(`Building userev command: ${userevCommand}`);
        }
        
        try {
            // 尝试执行userev命令
            if (isDebugEnabled()) {
                logDebug(`Attempting userev command...`);
            }
            await executeSoscmd(userevCommand, fileDir);
            vscode.window.showInformationMessage(`Successfully switched to version ${versionId}`);
            if (isDebugEnabled()) {
                logDebug(`userev command executed successfully`);
            }
        } catch (error) {
            // 详细记录错误（仅在调试模式下）
            if (isDebugEnabled()) {
                logError(`userev failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            
            // 检查是否是文件已被checkout的错误
            if (error instanceof Error && error.message.includes('has been checked out. You must first check it in or cancel the checkout.')) {
                // 文件已被checkout，需要先执行discard命令，向用户确认
                const confirmMessage = `File ${fileName} is checked out. Do you want to discard changes and switch to version ${versionId}?`;
                if (isDebugEnabled()) {
                    logDebug(`File is checked out, asking user for confirmation...`);
                }
                
                // 显示确认对话框，提供Yes/No选项
                const confirmResult = await vscode.window.showWarningMessage(
                    confirmMessage,
                    { modal: true },
                    'Yes',
                    'No'
                );
                
                if (confirmResult === 'Yes') {
                    // 用户确认执行discard操作
                    vscode.window.showWarningMessage(`Performing discard operation...`);
                    if (isDebugEnabled()) {
                        logDebug(`User confirmed discard operation`);
                    }
                    
                    // 执行discard命令，取消checkout
                    const discardCommand = `soscmd discard -F "${filePath}"`;
                    if (isDebugEnabled()) {
                        logDebug(`Building discard command: ${discardCommand}`);
                    }
                    
                    await executeSoscmd(discardCommand, fileDir);
                    if (isDebugEnabled()) {
                        logDebug(`discard command executed successfully`);
                    }
                    
                    // 重新执行userev命令
                    if (isDebugEnabled()) {
                        logDebug(`Retrying userev command after discard...`);
                    }
                    await executeSoscmd(userevCommand, fileDir);
                    vscode.window.showInformationMessage(`Successfully switched to version ${versionId} after discard`);
                    if (isDebugEnabled()) {
                        logDebug(`userev command executed successfully after discard`);
                    }
                } else {
                    // 用户取消操作
                    if (isDebugEnabled()) {
                        logDebug(`User cancelled discard and version switch`);
                    }
                    vscode.window.showInformationMessage(`Version switch cancelled`);
                    return;
                }
            } else {
                // 其他错误，重新抛出
                if (isDebugEnabled()) {
                    logError(`userev failed with non-checkout error, rethrowing...`);
                }
                throw error;
            }
        }
        
        // 刷新当前编辑器
        if (isDebugEnabled()) {
            logDebug(`Refreshing editor for ${filePath}`);
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            if (isDebugEnabled()) {
                logDebug(`Found active editor, updating content...`);
            }
            
            const fileUri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(content).toString();
            
            if (isDebugEnabled()) {
                logDebug(`Read file content (${text.length} characters)`);
            }
            
            // 只在内容实际发生变化时才执行编辑操作，避免不必要的dirty标记
            const currentText = activeEditor.document.getText();
            if (text !== currentText) {
                await activeEditor.edit(editBuilder => {
                    const fullRange = new vscode.Range(
                        activeEditor.document.positionAt(0),
                        activeEditor.document.positionAt(currentText.length)
                    );
                    editBuilder.replace(fullRange, text);
                });
                
                if (isDebugEnabled()) {
                    logDebug(`Editor content updated successfully (content changed)`);
                }
            } else {
                if (isDebugEnabled()) {
                    logDebug(`Editor content not updated (content unchanged)`);
                }
            }
            
            
        } else {
            if (isDebugEnabled()) {
                logDebug(`No active editor found for ${filePath}`);
            }
        }
        
        if (isDebugEnabled()) {
            logDebug(`switchFileVersion completed successfully`);
        }
    } catch (error) {
        // 详细的错误记录（仅在调试模式下记录堆栈跟踪）
        const errorMsg = `Failed to switch version: ${error instanceof Error ? error.message : String(error)}`;
        if (isDebugEnabled()) {
            logError(`switchFileVersion failed: ${errorMsg}`);
            logError(`Stack trace: ${error instanceof Error ? error.stack : ''}`);
        }
        vscode.window.showErrorMessage(errorMsg);
    }
}