import * as vscode from 'vscode';
import * as path from 'path';
import { FileStatus } from './soscmd';
import { logDebug, isDebugEnabled } from './utils';

/**
 * 判断文件是否"值得关注"：已修改、已检出、或有新版本
 */
export function isFileInteresting(status: FileStatus): boolean {
    return status.change === 'M'
        || status.change === '!'
        || status.newRevision === 'N'
        || status.state === 'O'
        || status.state === 'W';
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
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(path.basename(absolutePath), collapsibleState);
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

    constructor(
        private readonly workspaceRoot: string,
        private readonly statusCacheRef: Map<string, FileStatus>
    ) {}

    /**
     * 从 statusCache 重建过滤树
     */
    rebuild(): void {
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
            // 如果路径在 treeIndex 中有子节点且不是 interesting 文件本身，则为文件夹
            const hasChildren = this.treeIndex.has(childPath);
            const isInteresting = this.interestingFiles.has(childPath);
            const isDirectory = hasChildren && !isInteresting;

            const status = this.statusCacheRef.get(childPath) || null;
            items.push(new FilteredStatusItem(
                childPath,
                isDirectory,
                isDirectory ? null : status,
                isDirectory
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None
            ));
        }
        // 排序：文件夹在前，然后按名称字母排序
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

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
