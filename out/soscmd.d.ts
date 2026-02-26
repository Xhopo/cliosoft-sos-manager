export interface FileVersion {
    id: string;
    ciBy: string;
    ciTime: string;
    changeSummary: string;
}
export interface FileStatus {
    type: string;
    state: string;
    change: string;
    lock: string;
    newRevision: string;
    revision: string;
    path: string;
    author: string;
    time: string;
    log: string;
}
/**
 * 获取缓存的状态
 */
export declare function getCachedStatus(filePath: string): FileStatus | null;
/**
 * 设置状态缓存
 */
export declare function setCachedStatus(filePath: string, status: FileStatus, folderPath: string): void;
/**
 * 清除指定文件夹的缓存
 */
export declare function clearFolderCache(folderPath: string): void;
/**
 * 清除所有缓存
 */
export declare function clearAllCache(): void;
/**
 * 转义路径中的特殊字符，用于命令行参数
 */
export declare function escapePath(filePath: string): string;
/**
 * 安全地构建命令参数数组
 */
export declare function buildCommandArgs(baseArgs: string[], filePaths: string[]): string[];
/**
 * 执行soscmd命令 - 使用 spawn 方式，更安全地处理参数
 */
export declare function executeSoscmd(args: string[], cwd?: string, showError?: boolean): Promise<string>;
export declare function executeSoscmd(command: string, cwd?: string, showError?: boolean): Promise<string>;
/**
 * 解析单个状态行 - 使用固定宽度拆分策略，更健壮
 * SOS status 输出格式说明：
 * - 前6个字符是状态码，每个字符代表一种状态
 * - 状态码后跟版本号和文件路径
 * - 字段之间可能用空格或制表符分隔
 */
export declare function parseStatusLine(statusLine: string): FileStatus | null;
/**
 * 获取单个文件状态
 */
export declare function getFileStatus(filePath: string, useCache?: boolean): Promise<FileStatus | null>;
/**
 * 获取文件夹下所有文件的状态
 */
export declare function getFolderStatus(folderPath: string, useCache?: boolean): Promise<Map<string, FileStatus>>;
/**
 * 切换文件版本
 */
export declare function switchFileVersion(filePath: string, versionId: string): Promise<void>;
/**
 * 查询文件版本
 */
export declare function getFileVersions(filePath: string): Promise<FileVersion[]>;
//# sourceMappingURL=soscmd.d.ts.map