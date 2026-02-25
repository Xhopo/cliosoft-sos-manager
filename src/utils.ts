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


