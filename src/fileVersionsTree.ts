import * as vscode from 'vscode';
import { FileVersion, getFileVersions, getFileStatus } from './soscmd';
import { FileStatus } from './soscmd';
import { isDebugEnabled, logDebug, logError } from './utils';

export class FileVersionItem extends vscode.TreeItem {
    public readonly version: FileVersion | null;
    public readonly filePath: string | null;
    public readonly isCurrent: boolean;

    constructor(
        version: FileVersion | null,
        filePath: string | null,
        isCurrent: boolean = false,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(version ? version.id : 'No versions', collapsibleState);

        this.version = version;
        this.filePath = filePath;
        this.isCurrent = isCurrent;

        if (version === null) {
            this.tooltip = 'No versions available';
            this.description = '';
            this.contextValue = 'noVersions';
            this.iconPath = 'info';
        } else {
            this.tooltip = `Version ${version.id} - ${version.ciBy} - ${version.ciTime}\n${version.changeSummary}`;
            this.description = `${version.changeSummary}`;
            this.contextValue = 'fileVersion';

            if (isCurrent) {
                this.iconPath = new vscode.ThemeIcon('check');
                this.description = 'Current';
            } else {
                this.iconPath = new vscode.ThemeIcon('circle-outline');
            }

            this.command = {
                title: 'Switch to This Version',
                command: 'cliosoft-sos-manager.switchVersion',
                arguments: [filePath, version]
            };
        }
    }
}

export class FileVersionsTreeDataProvider implements vscode.TreeDataProvider<FileVersionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileVersionItem | undefined | null> = new vscode.EventEmitter<FileVersionItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<FileVersionItem | undefined | null> = this._onDidChangeTreeData.event;
    private currentFilePath: string | null = null;
    private currentFileStatus: FileStatus | null = null;
    private versionsCache = new Map<string, { versions: FileVersion[]; timestamp: number }>();
    private pendingVersions = new Map<string, Promise<FileVersion[]>>();
    private readonly versionsCacheTtl = 5 * 60 * 1000;

    refresh(): void {
        if (this.currentFilePath) {
            this.versionsCache.delete(this.currentFilePath);
        }
        this._onDidChangeTreeData.fire(null);
    }

    private async getCachedVersions(filePath: string): Promise<FileVersion[]> {
        const cached = this.versionsCache.get(filePath);
        if (cached && Date.now() - cached.timestamp < this.versionsCacheTtl) {
            if (isDebugEnabled()) {
                logDebug(`Using cached versions for: ${filePath}`);
            }
            return cached.versions;
        }

        const pending = this.pendingVersions.get(filePath);
        if (pending) { return pending; }

        const promise = getFileVersions(filePath);
        this.pendingVersions.set(filePath, promise);
        try {
            const versions = await promise;
            this.versionsCache.set(filePath, { versions, timestamp: Date.now() });
            return versions;
        } finally {
            this.pendingVersions.delete(filePath);
        }
    }

    async setFile(filePath: string): Promise<void> {
        this.currentFilePath = filePath;

        this.currentFileStatus = await getFileStatus(filePath);

        if (isDebugEnabled()) {
            logDebug(`File set to: ${filePath}`);
            logDebug(`File status: ${JSON.stringify(this.currentFileStatus)}`);
        }

        this.refresh();
    }

    getTreeItem(element: FileVersionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileVersionItem): Promise<FileVersionItem[]> {
        if (isDebugEnabled()) {
            logDebug(`getChildren called with element: ${element?.label}`);
        }

        if (!element) {
            if (!this.currentFilePath) {
                if (isDebugEnabled()) {
                    logDebug('No file selected, returning noVersions item');
                }
                return [new FileVersionItem(null, null, false)];
            }

            if (isDebugEnabled()) {
                logDebug(`Active file: ${this.currentFilePath}`);
            }

            const versions = await this.getCachedVersions(this.currentFilePath);
            if (isDebugEnabled()) {
                logDebug(`getFileVersions returned ${versions.length} versions`);
            }

            if (versions.length === 0) {
                if (isDebugEnabled()) {
                    logDebug(`No versions found, returning noVersions item`);
                }
                return [new FileVersionItem(null, this.currentFilePath, false)];
            }

            if (isDebugEnabled()) {
                logDebug(`Creating FileVersionItems for ${versions.length} versions`);
            }

            const currentRevision = this.currentFileStatus?.revision || '';
            return versions.map(version =>
                new FileVersionItem(version, this.currentFilePath, version.id === currentRevision)
            );
        }

        return [];
    }
}
