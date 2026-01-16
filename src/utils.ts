import * as vscode from 'vscode';

// 调试信息配置键
export const DEBUG_INFO_CONFIG_KEY = 'cliosoft-sos-manager.enableDebugInfo';

// 获取调试开关状态
export function isDebugEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(DEBUG_INFO_CONFIG_KEY, false);
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

// 执行命令的通用函数
export async function executeCommand(command: string, cwd?: string): Promise<void> {
    const { exec } = require('child_process');
    
    return new Promise<void>((resolve, reject) => {
        exec(command, { cwd }, (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
                const errorMessage = `Command execution failed: ${error.message}\nCommand: ${command}\nstdout: ${stdout}\nstderr: ${stderr}`;
                console.error(`[ERROR] ${errorMessage}`);
                vscode.window.showErrorMessage(errorMessage);
                reject(new Error(errorMessage));
                return;
            }
            
            resolve();
        });
    });
}
