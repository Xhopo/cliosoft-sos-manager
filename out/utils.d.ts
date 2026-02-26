import * as vscode from 'vscode';
export declare const DEBUG_INFO_CONFIG_KEY = "cliosoft-sos-manager.enableDebugInfo";
export declare function isDebugEnabled(): boolean;
export declare function getSelectedFilePath(context: any): string | null;
/**
 * 获取配置
 */
export declare function getConfig(): vscode.WorkspaceConfiguration;
/**
 * 检查命令是否启用
 */
export declare function isCommandEnabled(commandName: string): boolean;
/**
 * 获取命令配置
 */
export declare function getCommandConfig(commandName: string): string;
/**
 * 获取路径配置
 */
export declare function getPathConfig(pathName: string): string;
/**
 * 替换命令中的变量 - 支持数组格式和自动转义
 */
export declare function replaceCommandVariables(command: string, variables: Record<string, string | string[]>): string;
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
export declare function parseCommandArgs(command: string): string[];
/**
 * 检查当前平台是否支持
 */
export declare function isPlatformSupported(): boolean;
/**
 * 显示平台不支持警告
 */
export declare function showPlatformWarning(): Promise<void>;
/**
 * 批量处理配置
 */
export declare const BATCH_SIZE = 50;
/**
 * 延迟函数
 */
export declare function delay(ms: number): Promise<void>;
/**
 * 检查文件是否在 SOS 管理下
 */
export declare function isFileUnderSosControl(filePath: string): Promise<boolean>;
//# sourceMappingURL=utils.d.ts.map