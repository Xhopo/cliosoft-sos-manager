import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileStatus, getFolderStatus, getInterestingStatus, isStatusEqual } from './soscmd';
import { isDebugEnabled, logDebug, logError, getConfig } from './utils';
import { FilteredStatusTreeDataProvider, isFileInteresting } from './filteredStatusTree';

function getCacheExpiryTime(): number {
    return (getConfig().get<number>('cacheExpiryTime', 180)) * 1000;
}

const DEBOUNCE_TIMEOUT = 200;

export class FileStatusDecorator {
    private statusCache: Map<string, FileStatus> = new Map();
    private folderStatusCache: Map<string, { statusMap: Map<string, FileStatus>, timestamp: number }> = new Map();
    private pendingFolderUpdates: Map<string, Promise<void>> = new Map();
    private readonly decorationChangeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    private readonly _onDidUpdateStatus = new vscode.EventEmitter<void>();
    readonly onDidUpdateStatus: vscode.Event<void> = this._onDidUpdateStatus.event;
    private fileDecorationProvider: vscode.FileDecorationProvider;
    private fileDecorationProviderRegistration: vscode.Disposable | undefined;
    private isPaused: boolean = false;
    private statusBarItem: vscode.StatusBarItem;
    private readonly cacheExpiryTime = getCacheExpiryTime();
    private readonly debounceTimeout = DEBOUNCE_TIMEOUT;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private diskCachePath: string | undefined;
    private filteredTreeProvider: FilteredStatusTreeDataProvider | undefined;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem('cliosoft-sos-manager.refreshToggle', vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = '$(sync) SOS: Active';
        this.statusBarItem.command = 'cliosoft-sos-manager.toggleRefresh';
        this.statusBarItem.tooltip = 'SOS status refresh is active. Click to pause.';
        this.statusBarItem.show();

        this.fileDecorationProvider = {
            provideFileDecoration: (uri: vscode.Uri) => {
                const filePath = uri.fsPath;
                const status = this.statusCache.get(filePath);

                if (!status) {
                    return undefined;
                }

                let badge = '';
                let color: vscode.ThemeColor | undefined;
                const tooltipParts: string[] = [];
                const isCheckedOut = status.state === 'O' || status.state === 'W';
                const isCheckedIn = status.state === '-';
                const isModified = status.change === 'M';
                const isDeleted = status.change === '!';
                const hasNewRevision = status.newRevision === 'N';

                if (isCheckedOut) {
                    tooltipParts.push('Checked Out');
                    color = new vscode.ThemeColor('gitDecoration.addedResourceForeground');
                } else if (isCheckedIn) {
                    tooltipParts.push('Checked In');
                    color = new vscode.ThemeColor('gitDecoration.untrackedResourceForeground');
                }

                if (isModified) {
                    tooltipParts.push(isCheckedOut ? 'Modified' : 'Modified (not checked out)');
                    color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
                } else if (isDeleted) {
                    tooltipParts.push('Deleted');
                    color = new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
                }

                if (hasNewRevision) {
                    tooltipParts.push('Has New Revision');
                    color = new vscode.ThemeColor('gitDecoration.conflictingResourceForeground');
                }

                if (isModified && hasNewRevision) {
                    badge = 'M!';
                } else if (isDeleted && hasNewRevision) {
                    badge = 'D!';
                } else if (isModified) {
                    badge = isCheckedOut ? `${status.state}M` : 'M';
                } else if (isDeleted) {
                    badge = 'D';
                } else if (hasNewRevision) {
                    badge = isCheckedOut ? `${status.state}!` : 'N!';
                } else if (isCheckedOut) {
                    badge = 'CO';
                } else if (isCheckedIn) {
                    badge = 'CI';
                }

                if (badge) {
                    return {
                        badge,
                        color,
                        tooltip: tooltipParts.join(', ')
                    };
                }

                return undefined;
            },
            onDidChangeFileDecorations: this.decorationChangeEmitter.event
        };

        this.fileDecorationProviderRegistration = vscode.window.registerFileDecorationProvider(this.fileDecorationProvider);
    }

    setFilteredTreeProvider(provider: FilteredStatusTreeDataProvider): void {
        this.filteredTreeProvider = provider;
    }

    fireDecorationChange(): void {
        this.decorationChangeEmitter.fire(undefined);
    }

    get fileStatusCache(): Map<string, FileStatus> {
        return this.statusCache;
    }

    async performFullWorkspaceScan(
        workspaceRoot: string,
        progress?: vscode.Progress<{ message?: string }>,
        cancellationToken?: vscode.CancellationToken
    ): Promise<number | undefined> {
        progress?.report({ message: 'Querying SOS for changed files...' });

        const statusMap = await getInterestingStatus(workspaceRoot, cancellationToken);

        if (!statusMap || cancellationToken?.isCancellationRequested) { return undefined; }

        this.folderStatusCache.clear();

        for (const [filePath, oldStatus] of this.statusCache) {
            if (isFileInteresting(oldStatus) && !statusMap.has(filePath)) {
                this.statusCache.delete(filePath);
            }
        }

        statusMap.forEach((status, filePath) => {
            this.statusCache.set(filePath, status);
        });

        logDebug(`performFullWorkspaceScan: ${statusMap.size} interesting files, statusCache: ${this.statusCache.size}`);

        progress?.report({ message: `Found ${statusMap.size} changed files` });

        this.decorationChangeEmitter.fire(undefined);
        this._onDidUpdateStatus.fire();
        this.saveDiskCache();
        return statusMap.size;
    }

    setDiskCachePath(cachePath: string): void {
        this.diskCachePath = cachePath;
    }

    loadDiskCache(): boolean {
        if (!this.diskCachePath) { return false; }
        try {
            if (!fs.existsSync(this.diskCachePath)) { return false; }
            const raw = fs.readFileSync(this.diskCachePath, 'utf-8');
            const data: { timestamp: number; entries: [string, FileStatus][] } = JSON.parse(raw);
            if (!Array.isArray(data.entries) || data.entries.length === 0) { return false; }

            const DISK_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
            if (data.timestamp && (Date.now() - data.timestamp) > DISK_CACHE_MAX_AGE) {
                logDebug(`Disk cache expired (saved ${new Date(data.timestamp).toLocaleString()}), skipping`);
                return false;
            }

            for (const [filePath, status] of data.entries) {
                this.statusCache.set(filePath, status);
            }
            this.decorationChangeEmitter.fire(undefined);
            this._onDidUpdateStatus.fire();
            logDebug(`Loaded ${data.entries.length} cached status entries from disk (saved ${new Date(data.timestamp).toLocaleString()})`);
            return true;
        } catch (e) {
            logDebug(`Failed to load disk cache: ${e}`);
            return false;
        }
    }

    private saveDiskCache(): void {
        if (!this.diskCachePath) { return; }
        const cachePath = this.diskCachePath;
        const data = {
            timestamp: Date.now(),
            entries: Array.from(this.statusCache.entries())
        };
        const json = JSON.stringify(data);

        const dir = path.dirname(cachePath);
        fs.mkdir(dir, { recursive: true }, () => {
            fs.writeFile(cachePath, json, 'utf-8', (err) => {
                if (err) {
                    logDebug(`Failed to save disk cache: ${err}`);
                } else {
                    logDebug(`Saved ${data.entries.length} status entries to disk cache`);
                }
            });
        });
    }

    toggleRefresh(): void {
        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            this.statusBarItem.text = '$(debug-pause) SOS: Paused';
            this.statusBarItem.tooltip = 'SOS status refresh is paused. Click to resume.';
        } else {
            this.statusBarItem.text = '$(sync) SOS: Active';
            this.statusBarItem.tooltip = 'SOS status refresh is active. Click to pause.';
        }
    }

    updateFileStatus(filePath: string): void {
        if (this.isPaused) {
            return;
        }

        const folderPath = path.dirname(filePath);
        this.statusCache.delete(filePath);
        const existing = this.debounceTimers.get(folderPath);
        if (existing) {
            clearTimeout(existing);
        }

        this.debounceTimers.set(folderPath, setTimeout(async () => {
            this.debounceTimers.delete(folderPath);
            await this.doUpdateFileAndAncestors(filePath);
        }, this.debounceTimeout));
    }

    updatePathStatus(targetPath: string): void {
        if (this.isPaused) {
            return;
        }

        try {
            if (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isDirectory()) {
                this.clearFolderCache(targetPath);
                void this.updateFolderAndAncestors(targetPath);
                return;
            }
        } catch (error) {
            if (isDebugEnabled()) {
                logError(`Failed to stat path for status update ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        this.updateFileStatus(targetPath);
    }

    private async updateFolderAndAncestors(folderPath: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(folderPath));
            if (!workspaceFolder) {
                return;
            }

            const workspaceRoot = workspaceFolder.uri.fsPath;

            this.folderStatusCache.delete(folderPath);
            await this.updateFolderStatus(folderPath);

            let parent = path.dirname(folderPath);
            while (parent.length >= workspaceRoot.length) {
                this.folderStatusCache.delete(parent);
                await this.updateFolderStatus(parent);
                if (parent === workspaceRoot) { break; }
                parent = path.dirname(parent);
            }
        } catch (error) {
            if (isDebugEnabled()) {
                logError(`Failed to update folder status: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    private async doUpdateFileAndAncestors(filePath: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
            if (!workspaceFolder) {
                return;
            }

            const workspaceRoot = workspaceFolder.uri.fsPath;
            const folderPath = path.dirname(filePath);

            // 1. 当前目录：强制刷新同级所有文件（含 CI）
            this.folderStatusCache.delete(folderPath);
            await this.updateFolderStatus(folderPath);

            // 2. 祖先目录：逐级查询（走 cache TTL，未过期不发 soscmd）
            let parent = path.dirname(folderPath);
            while (parent.length >= workspaceRoot.length) {
                await this.updateFolderStatus(parent);
                if (parent === workspaceRoot) { break; }
                parent = path.dirname(parent);
            }

            // 不在单文件操作后自动触发全工作区扫描。
            // 全量 scan 在大项目中可能耗时十几秒，并会刷新 Changed Files 树，造成明显 UI 抖动。
            // 用户需要全局同步时，使用 Changed Files 视图的手动刷新即可。
        } catch (error) {
            if (isDebugEnabled()) {
                logError(`Failed to update file status: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    async updateFolderStatus(folderPath: string): Promise<void> {
        if (this.pendingFolderUpdates.has(folderPath)) {
            return this.pendingFolderUpdates.get(folderPath)!;
        }

        const cached = this.folderStatusCache.get(folderPath);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < this.cacheExpiryTime) {
            if (isDebugEnabled()) {
                logDebug(`Using cached status for folder: ${folderPath}`);
            }

            cached.statusMap.forEach((status, filePath) => {
                this.statusCache.set(filePath, status);
            });

            const uris = Array.from(cached.statusMap.keys())
                .map(filePath => {
                    try { return vscode.Uri.file(filePath); } catch { return null; }
                })
                .filter((uri): uri is vscode.Uri => uri !== null);

            if (uris.length > 0) {
                this.decorationChangeEmitter.fire(uris);
            }

            return;
        }

        const updatePromise = this.doUpdateFolderStatus(folderPath);
        this.pendingFolderUpdates.set(folderPath, updatePromise);

        try {
            await updatePromise;
        } finally {
            this.pendingFolderUpdates.delete(folderPath);
        }
    }

    private async doUpdateFolderStatus(folderPath: string): Promise<void> {
        try {
            if (!fs.existsSync(folderPath) || !fs.lstatSync(folderPath).isDirectory()) {
                return;
            }

            if (isDebugEnabled()) {
                logDebug(`Getting status for folder: ${folderPath}`);
            }

            const statusMap = await getFolderStatus(folderPath);
            const now = Date.now();

            this.folderStatusCache.set(folderPath, {
                statusMap,
                timestamp: now
            });

            if (isDebugEnabled()) {
                logDebug(`Got ${statusMap.size} status entries from soscmd and cached`);
            }

            statusMap.forEach((status, filePath) => {
                this.statusCache.set(filePath, status);
            });

            if (isDebugEnabled()) {
                logDebug(`Wrote ${statusMap.size} paths to statusCache, size: ${this.statusCache.size}`);
            }

            const uris = Array.from(statusMap.keys())
                .map(filePath => {
                    try { return vscode.Uri.file(filePath); } catch { return null; }
                })
                .filter((uri): uri is vscode.Uri => uri !== null);

            if (uris.length > 0) {
                this.decorationChangeEmitter.fire(uris);
                this._onDidUpdateStatus.fire();
            }
        } catch (error) {
            if (isDebugEnabled()) {
                logError(`Failed to update folder status for ${folderPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
            throw error;
        }
    }

    clearCache(): void {
        this.statusCache.clear();
        this.folderStatusCache.clear();
        this._onDidUpdateStatus.fire();
    }

    clearFolderCache(folderPath: string): void {
        this.folderStatusCache.delete(folderPath);
        const prefix = folderPath + path.sep;
        for (const filePath of this.statusCache.keys()) {
            if (filePath.startsWith(prefix) || filePath === folderPath) {
                this.statusCache.delete(filePath);
            }
        }
    }

    dispose(): void {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        this.decorationChangeEmitter.dispose();
        this._onDidUpdateStatus.dispose();

        this.statusCache.clear();
        this.folderStatusCache.clear();
        this.pendingFolderUpdates.clear();

        if (this.fileDecorationProviderRegistration) {
            this.fileDecorationProviderRegistration.dispose();
            this.fileDecorationProviderRegistration = undefined;
        }

        if (this.statusBarItem) {
            this.statusBarItem.dispose();
        }
    }
}
