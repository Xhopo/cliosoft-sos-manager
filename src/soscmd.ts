import { exec, spawn } from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { isDebugEnabled, logDebug, logError, showSosError } from './utils';

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
    if (output.includes('timed out') || output.includes('Timed out') || output.includes('ETIMEDOUT')) {
        return 'Command timed out. The SOS server may be slow or unreachable';
    }
    if (output.includes('refused') || output.includes('ECONNREFUSED')) {
        return 'Connection refused. Please check if the SOS server is running';
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
            }
            
            const proc = spawn('soscmd', commandOrArgs, { cwd, shell: true, timeout: 60000 });
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
                        showSosError(errorMessage);
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
                    showSosError(errorMessage);
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
            }
            
            exec(command, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
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
                        showSosError(errorMessage);
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
        showSosError(errorMsg);
        return [];
    }
}

// 解析单个状态行
export function parseStatusLine(statusLine: string): FileStatus | null {
    if (isDebugEnabled()) {
        logDebug(`Parsing status line: ${statusLine}`);
    }

    const normalizedLine = statusLine.replace(/\t/g, ' ');

    // 统一正则：类型(fpdsFPDS) + 状态5字符 + 空白 + 版本号 + 空白 + 路径
    const m = normalizedLine.match(/^([fpdsFPDS])([-OWXN?])([-M!?-])([-L?-])([-N?-])([-R?-])\s+(\S+)\s+(.+)$/);
    if (m) {
        const [, type, state, change, lock, newRevision, , version, fileStatusPath] = m;
        return {
            type, state, change, lock, newRevision,
            revision: version,
            path: fileStatusPath.trim(),
            author: '', time: '', log: ''
        };
    }

    // fallback：前6字符当状态码（仅当首字符是合法类型时）
    const fb = normalizedLine.match(/^([fpdsFPDS].{5})\s+(\S+)\s+(.+)$/);
    if (fb) {
        const [, statusCode, version, fileStatusPath] = fb;
        return {
            type: statusCode[0],
            state: statusCode[1] || '-',
            change: statusCode[2] || '-',
            lock: statusCode[3] || '-',
            newRevision: statusCode[4] || '-',
            revision: version,
            path: fileStatusPath.trim(),
            author: '', time: '', log: ''
        };
    }

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
        if (!fs.existsSync(folderPath)) {
            return statusMap;
        }

        if (isDebugEnabled()) {
            logDebug(`getFolderStatus called with folderPath: ${folderPath}`);
        }

        const output = await executeSoscmd(['status', '*'], folderPath, false);
        const lines = output.trim().split('\n');

        for (const line of lines) {
            if (line.trim().length === 0 || line.includes('@@ Error') || line.includes('Error:')) {
                continue;
            }

            const status = parseStatusLine(line);
            if (!status) { continue; }

            const filePath = path.isAbsolute(status.path)
                ? status.path
                : path.join(folderPath, status.path);
            statusMap.set(filePath, { ...status, path: filePath });
        }

        if (isDebugEnabled()) {
            logDebug(`getFolderStatus returned ${statusMap.size} statuses`);
        }
    } catch (error) {
        if (isDebugEnabled()) {
            logError(`getFolderStatus failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return statusMap;
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
        // -sco: checked out, -suco: checked out without lock
        // status 命令默认 OR 模式，select 参数自带递归
        const output = await executeSoscmd(
            ['status', '*', '-sco', '-suco'],
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

// 切换文件版本，返回是否成功
export async function switchFileVersion(filePath: string, versionId: string): Promise<boolean> {
    try {
        if (isDebugEnabled()) {
            logDebug(`switchFileVersion called with filePath: ${filePath}, versionId: ${versionId}`);
        }

        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);

        if (isDebugEnabled()) {
            logDebug(`File directory: ${fileDir}`);
            logDebug(`File name: ${fileName}`);
        }

        // 先检查文件是否已被 checkout，如果是则提前提示用户
        const fileStatus = await getFileStatus(filePath);
        if (fileStatus && (fileStatus.state === 'O' || fileStatus.state === 'W')) {
            if (isDebugEnabled()) {
                logDebug(`File is checked out (state=${fileStatus.state}), prompting user before userev`);
            }

            const confirmResult = await vscode.window.showWarningMessage(
                `File ${fileName} is checked out. Do you want to discard changes and switch to version ${versionId}?`,
                { modal: true },
                'Yes',
                'No'
            );

            if (confirmResult !== 'Yes') {
                if (isDebugEnabled()) {
                    logDebug(`User cancelled discard and version switch`);
                }
                vscode.window.showInformationMessage(`Version switch cancelled`);
                return false;
            }

            // 用户确认，先 discard 再 userev
            if (isDebugEnabled()) {
                logDebug(`User confirmed discard operation`);
            }

            const discardCommand = `soscmd discard -F "${filePath}"`;
            await executeSoscmd(discardCommand, fileDir);
            if (isDebugEnabled()) {
                logDebug(`discard command executed successfully`);
            }
        } else {
            // 非 CO 文件也确认一下，防止意外覆盖
            const confirmResult = await vscode.window.showWarningMessage(
                `Switch ${fileName} to version ${versionId}? This will overwrite the local file.`,
                { modal: true },
                'Yes',
                'No'
            );

            if (confirmResult !== 'Yes') {
                return false;
            }
        }

        // 执行 userev（文件未 checkout 或已 discard 后）
        const userevCommand = `soscmd userev "${filePath}/${versionId}"`;
        if (isDebugEnabled()) {
            logDebug(`Executing userev command: ${userevCommand}`);
        }

        await executeSoscmd(userevCommand, fileDir);
        vscode.window.showInformationMessage(`Successfully switched to version ${versionId}`);

        if (isDebugEnabled()) {
            logDebug(`switchFileVersion completed successfully`);
        }
        return true;
    } catch (error) {
        const errorMsg = `Failed to switch version: ${error instanceof Error ? error.message : String(error)}`;
        if (isDebugEnabled()) {
            logError(`switchFileVersion failed: ${errorMsg}`);
            logError(`Stack trace: ${error instanceof Error ? error.stack : ''}`);
        }
        showSosError(errorMsg);
        return false;
    }
}