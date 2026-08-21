import * as vscode from 'vscode';
import * as path from 'path';
import { FileStatus } from './soscmd';
import { logDebug, isDebugEnabled } from './utils';

/**
 * 判断文件是否应出现在 Changed Files 树中：
 * 已检出、已修改、已删除、有新版本
 */
export function isFileInteresting(status: FileStatus): boolean {
    return status.state === 'O'
        || status.state === 'W'
        || status.change === 'M'
        || status.change === '!'
        || status.newRevision === 'N';
}

/**
 * 状态描述文本
 */
function statusDescription(status: FileStatus): string {
    const parts: string[] = [];
    if (status.state === 'O' || status.state === 'W') {
        parts.push('Checked Out');
    }
    if (status.change === 'M') {
        parts.push('Modified');
    }
    if (status.change === '!') {
        parts.push('Deleted');
    }
    if (status.newRevision === 'N') {
        parts.push('New Revision');
    }
    return parts.join(', ');
}

/**
 * 过滤状态树的节点
 */
class FilteredStatusItem extends vscode.TreeItem {
    constructor(
        public readonly absolutePath: string,
        public readonly isDirectory: boolean,
        public readonly fileStatus: FileStatus | null,
        collapsibleState: vscode.TreeItemCollapsibleState,
        childFileCount?: number
    ) {
        super(path.basename(absolutePath), collapsibleState);
        this.id = absolutePath;
        this.resourceUri = vscode.Uri.file(absolutePath);

        if (!isDirectory && fileStatus) {
            this.description = statusDescription(fileStatus);
            this.tooltip = `${absolutePath}\nRev: ${fileStatus.revision}  ${statusDescription(fileStatus)}`;
            this.command = {
                title: 'Open File',
                command: 'vscode.open',
                arguments: [vscode.Uri.file(absolutePath)]
            };
            this.contextValue = 'filteredFile';
        } else {
            this.description = childFileCount !== undefined ? `(${childFileCount})` : '';
            this.tooltip = absolutePath;
            this.contextValue = 'filteredFolder';
        }
    }
}

/**
 * 提供"Changed Files"树视图的数据
 * 从 FileStatusDecorator 的 statusCache 中读取数据，过滤并构建层级树
 */
export class FilteredStatusTreeDataProvider implements vscode.TreeDataProvider<FilteredStatusItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<FilteredStatusItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // 父路径 → 直接子路径集合（裁剪后的树结构）
    private treeIndex = new Map<string, Set<string>>();
    // 记录匹配的文件路径，用于区分文件和文件夹
    private interestingFiles = new Set<string>();
    private rebuildTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly workspaceRoot: string,
        private readonly statusCacheRef: Map<string, FileStatus>
    ) {}

    /**
     * 防抖 rebuild：短时间内多次调用只执行一次
     */
    rebuild(): void {
        if (this.rebuildTimer) { clearTimeout(this.rebuildTimer); }
        this.rebuildTimer = setTimeout(() => {
            this.rebuildTimer = undefined;
            this.doRebuild();
        }, 100);
    }

    /**
     * 同步立即 rebuild，跳过防抖。
     * 用于 decoration fire 之前确保 interestingFiles 数据已更新。
     */
    rebuildSync(): void {
        if (this.rebuildTimer) {
            clearTimeout(this.rebuildTimer);
            this.rebuildTimer = undefined;
        }
        this.doRebuild();
    }

    private doRebuild(): void {
        this.treeIndex.clear();
        this.interestingFiles.clear();

        for (const [filePath, status] of this.statusCacheRef) {
            if (status.type === 'd') { continue; }
            if (!isFileInteresting(status)) { continue; }
            if (!filePath.startsWith(this.workspaceRoot)) { continue; }

            this.interestingFiles.add(filePath);

            // 从文件向上回溯到 workspaceRoot，确保每个祖先文件夹都在树中
            let child = filePath;
            let parent = path.dirname(filePath);

            while (parent.length >= this.workspaceRoot.length) {
                if (!this.treeIndex.has(parent)) {
                    this.treeIndex.set(parent, new Set());
                }
                this.treeIndex.get(parent)!.add(child);

                if (parent === this.workspaceRoot) { break; }
                child = parent;
                parent = path.dirname(parent);
            }
        }

        if (isDebugEnabled()) {
            logDebug(`FilteredStatusTree rebuilt: ${this.interestingFiles.size} files, ${this.treeIndex.size} folders`);
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    isEmpty(): boolean {
        return this.interestingFiles.size === 0;
    }

    hasFile(filePath: string): boolean {
        return this.interestingFiles.has(filePath);
    }

    getParent(element: FilteredStatusItem): FilteredStatusItem | null {
        if (!element.absolutePath) { return null; }
        const parentPath = path.dirname(element.absolutePath);
        if (parentPath === this.workspaceRoot || parentPath.length < this.workspaceRoot.length) {
            return null;
        }
        return new FilteredStatusItem(parentPath, true, null, vscode.TreeItemCollapsibleState.Expanded);
    }

    findItem(filePath: string): FilteredStatusItem | undefined {
        if (!this.interestingFiles.has(filePath)) { return undefined; }
        const status = this.statusCacheRef.get(filePath) || null;
        return new FilteredStatusItem(filePath, false, status, vscode.TreeItemCollapsibleState.None);
    }

    getTreeItem(element: FilteredStatusItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FilteredStatusItem): FilteredStatusItem[] {
        if (!element) {
            // 根级别：返回 workspaceRoot 的直接子节点
            const children = this.treeIndex.get(this.workspaceRoot);
            if (!children || children.size === 0) {
                // 空状态提示
                const placeholder = new vscode.TreeItem(
                    'No changed files found',
                    vscode.TreeItemCollapsibleState.None
                ) as any;
                placeholder.absolutePath = '';
                placeholder.isDirectory = false;
                placeholder.fileStatus = null;
                placeholder.description = 'Click refresh to scan workspace';
                return [placeholder];
            }
            return this.buildItems(children);
        }

        if (element.isDirectory) {
            const children = this.treeIndex.get(element.absolutePath);
            if (!children) { return []; }
            return this.buildItems(children);
        }

        return [];
    }

    private buildItems(childPaths: Set<string>): FilteredStatusItem[] {
        const items: FilteredStatusItem[] = [];
        for (const childPath of childPaths) {
            const hasChildren = this.treeIndex.has(childPath);
            const isInteresting = this.interestingFiles.has(childPath);
            const isDirectory = hasChildren && !isInteresting;

            const status = this.statusCacheRef.get(childPath) || null;
            const childFileCount = isDirectory ? this.getInterestingFileCount(childPath) : undefined;
            items.push(new FilteredStatusItem(
                childPath,
                isDirectory,
                isDirectory ? null : status,
                isDirectory
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None,
                childFileCount
            ));
        }
        items.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) { return a.isDirectory ? -1 : 1; }
            return path.basename(a.absolutePath).localeCompare(path.basename(b.absolutePath));
        });
        return items;
    }

    /**
     * 获取某个文件夹路径下所有 interesting 文件的 Uri 列表
     */
    getInterestingFileUris(folderPath: string): vscode.Uri[] {
        const uris: vscode.Uri[] = [];
        for (const filePath of this.interestingFiles) {
            if (filePath.startsWith(folderPath + path.sep) || filePath.startsWith(folderPath + '/')) {
                uris.push(vscode.Uri.file(filePath));
            }
        }
        return uris;
    }

    /**
     * 获取某个文件夹路径下 interesting 文件的数量
     */
    getInterestingFileCount(folderPath: string): number {
        let count = 0;
        const prefix1 = folderPath + path.sep;
        const prefix2 = folderPath + '/';
        for (const filePath of this.interestingFiles) {
            if (filePath.startsWith(prefix1) || filePath.startsWith(prefix2)) {
                count++;
            }
        }
        return count;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
