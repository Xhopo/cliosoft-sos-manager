import * as vscode from 'vscode';

// 调试信息配置键
export const DEBUG_INFO_CONFIG_KEY = 'cliosoft-sos-manager.enableDebugInfo';

// 创建输出通道
export const outputChannel = vscode.window.createOutputChannel('ClioSoft SOS');

// 获取调试开关状态
export function isDebugEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(DEBUG_INFO_CONFIG_KEY, false);
}

// 调试日志函数
export function logDebug(message: string, ...args: any[]): void {
    if (isDebugEnabled()) {
        const line = `[DEBUG ${new Date().toLocaleTimeString()}] ${message}`;
        console.log(line, ...args);
        outputChannel.appendLine(line + (args.length ? ' ' + JSON.stringify(args) : ''));
    }
}

// 错误日志函数
export function logError(message: string, error?: any): void {
    const line = `[ERROR ${new Date().toLocaleTimeString()}] ${message}`;
    console.error(line, error);
    outputChannel.appendLine(line + (error ? ' ' + error : ''));
}

// 获取当前选中的文件路径
export function getSelectedFilePath(context: any): string | null {
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

/**
 * 获取配置
 */
export function getConfig() {
    return vscode.workspace.getConfiguration('cliosoft-sos-manager');
}

/**
 * 检查命令是否启用
 */
export function isCommandEnabled(commandName: string): boolean {
    const config = getConfig();
    return config.get(`commands.${commandName}.enable`, true);
}

/**
 * 获取命令配置
 */
export function getCommandConfig(commandName: string): string {
    const config = getConfig();
    return config.get(`commands.${commandName}.command`, '');
}

/**
 * 获取路径配置
 */
export function getPathConfig(pathName: string): string {
    const config = getConfig();
    return config.get(`paths.${pathName}`, '');
}

/**
 * 替换命令中的变量 - 支持数组格式和自动转义
 */
export function replaceCommandVariables(
    command: string,
    variables: Record<string, string | string[]>
): string {
    let result = command;
    for (const [key, value] of Object.entries(variables)) {
        if (Array.isArray(value)) {
            // 对于数组，将每个元素用引号包裹后用空格连接
            const escapedValue = value.map(v => `"${v.replace(/"/g, '\\"')}"`).join(' ');
            result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), escapedValue);
        } else {
            // 对于字符串，如果不是已经带引号的路径，则添加引号
            const escapedValue = value.includes('"') ? value : '"' + value + '"';
            result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), escapedValue);
        }
    }
    return result;
}

/**
 * 智能分割命令字符串 - 支持带引号的参数
 * 解决 split(/\s+/) 会错误分割带空格参数的问题
 * 
 * @example
 * parseCommandArgs('ci -aLog="fix bug" file.txt')
 * // Returns: ['ci', '-aLog="fix bug"', 'file.txt']
 * 
 * @example
 * parseCommandArgs('co "path with spaces/file.txt"')
 * // Returns: ['co', '"path with spaces/file.txt"']
 */
export function parseCommandArgs(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    
    for (let i = 0; i < command.length; i++) {
        const char = command[i];
        
        if (inQuote) {
            // 在引号内
            if (char === quoteChar) {
                // 检查是否是转义引号
                if (i > 0 && command[i - 1] === '\\') {
                    current += char;
                } else {
                    // 引号结束
                    current += char;
                    inQuote = false;
                    quoteChar = '';
                }
            } else {
                current += char;
            }
        } else {
            // 不在引号内
            if (char === '"' || char === "'") {
                // 开始引号
                inQuote = true;
                quoteChar = char;
                current += char;
            } else if (char === ' ' || char === '\t') {
                // 空白字符分隔参数
                if (current.length > 0) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }
    }
    
    // 添加最后一个参数
    if (current.length > 0) {
        args.push(current);
    }
    
    return args;
}

/**
 * 检查当前平台是否支持
 */
export function isPlatformSupported(): boolean {
    return process.platform === 'linux';
}

/**
 * 显示平台不支持警告
 */
export async function showPlatformWarning(): Promise<void> {
    const message = 'ClioSoft SOS Manager is designed to run on Linux only. ' +
        'All SOS commands are disabled on this platform.';
    
    const result = await vscode.window.showWarningMessage(
        message,
        'Learn More',
        'Dismiss'
    );
    
    if (result === 'Learn More') {
        // 打开扩展文档
        vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/xhopo/cliosoft-sos-manager#requirements')
        );
    }
}

/**
 * 批量处理配置
 */
export const BATCH_SIZE = 50;

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检查文件是否在 SOS 管理下
 */
export async function isFileUnderSosControl(filePath: string): Promise<boolean> {
    try {
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            return false;
        }

        // 检查文件所在目录是否有 SOS 相关文件
        const fileDir = require('path').dirname(filePath);
        const sosConfigPath = require('path').join(fileDir, '.sos');

        return fs.existsSync(sosConfigPath);
    } catch {
        return false;
    }
}
