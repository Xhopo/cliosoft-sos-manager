import * as vscode from 'vscode';

// 调试信息配置键
export const DEBUG_INFO_CONFIG_KEY = 'cliosoft-sos-manager.enableDebugInfo';

// 创建输出通道
export const outputChannel = vscode.window.createOutputChannel('ClioSoft SOS');

// 缓存调试开关，避免每次调用都读配置
let _debugEnabled: boolean = false;
let _debugEnabledInitialized = false;

function ensureDebugConfigListener(): void {
    if (_debugEnabledInitialized) { return; }
    _debugEnabledInitialized = true;
    _debugEnabled = vscode.workspace.getConfiguration().get<boolean>(DEBUG_INFO_CONFIG_KEY, false);
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(DEBUG_INFO_CONFIG_KEY)) {
            _debugEnabled = vscode.workspace.getConfiguration().get<boolean>(DEBUG_INFO_CONFIG_KEY, false);
        }
    });
}

// 获取调试开关状态
export function isDebugEnabled(): boolean {
    ensureDebugConfigListener();
    return _debugEnabled;
}

// 调试日志函数
export function logDebug(message: string, ...args: any[]): void {
    if (isDebugEnabled()) {
        const line = `[DEBUG ${new Date().toLocaleTimeString()}] ${message}`;
        console.log(line, ...args);
        outputChannel.appendLine(line + (args.length ? ' ' + JSON.stringify(args) : ''));
    }
}

// 错误日志函数（错误时自动弹出输出面板，可配置）
export function logError(message: string, error?: any): void {
    const line = `[ERROR ${new Date().toLocaleTimeString()}] ${message}`;
    console.error(line, error);
    outputChannel.appendLine(line + (error ? ' ' + error : ''));

    if (getConfig().get<boolean>('autoShowOutputOnError', false)) {
        outputChannel.show(true); // preserveFocus = true
    }
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
 * 替换命令中的变量 - 支持数组格式和自动转义
 */
export function replaceCommandVariables(
    command: string,
    variables: Record<string, string | string[]>
): string {
    let result = command;
    for (const [key, value] of Object.entries(variables)) {
        if (Array.isArray(value)) {
            const escapedValue = value.map(v => `"${v.replace(/"/g, '\\"')}"`).join(' ');
            result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), escapedValue);
        } else {
            const escapedValue = value.includes('"') ? value : '"' + value + '"';
            result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), escapedValue);
        }
    }
    return result;
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
 * Show error message with "Show Output" button
 */
export function showSosError(message: string): void {
    vscode.window.showErrorMessage(message, 'Show Output').then(choice => {
        if (choice === 'Show Output') {
            outputChannel.show();
        }
    });
}
