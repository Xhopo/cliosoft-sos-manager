import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { FileVersion, executeSoscmd, getFileVersions } from './soscmd';
import { isDebugEnabled, logDebug, logError, isCommandEnabled, getCommandConfig, replaceCommandVariables, BATCH_SIZE, isPlatformSupported, showPlatformWarning, outputChannel, getConfig, showSosError } from './utils';
import { FilteredStatusTreeDataProvider } from './filteredStatusTree';
import { FileStatusDecorator } from './fileStatusDecorator';
import { FileVersionsTreeDataProvider } from './fileVersionsTree';

const execAsync = promisify(exec);

function getStatusRefreshInterval(): number {
    return (getConfig().get<number>('statusRefreshInterval', 30)) * 1000;
}
function isDiskCacheEnabled(): boolean {
    return getConfig().get<boolean>('enableDiskCache', true);
}

const TAB_POLLING_INTERVAL = 1000;

/**
 * 版本切换后重新加载编辑器中的文件，消除"未保存"标记。
 * SOS userev 直接修改了磁盘文件，但 VSCode 编辑器仍持有旧内容，
 * 导致内存内容与磁盘不一致，标签页出现 dirty dot。
 * 这里通过 revert 让编辑器重新从磁盘读取文件。
 */
async function revertFileInEditor(filePath: string): Promise<void> {
    const fileUri = vscode.Uri.file(filePath);
    const doc = vscode.workspace.textDocuments.find(
        d => d.uri.fsPath === fileUri.fsPath
    );
    if (doc && doc.isDirty) {
        const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
        if (editor) {
            await vscode.commands.executeCommand('workbench.action.files.revert');
            logDebug(`Reverted file in editor: ${filePath}`);
        }
    }
}

/**
 * 从命令参数中提取 Uri 数组。
 * 兼容四种调用来源：
 *  1. Explorer 右键菜单：(uri: Uri, uris: Uri[])
 *  2. Changed Files 树视图右键单选：(treeItem, [treeItem])
 *  3. Changed Files 树视图多选：(treeItem, [treeItem, treeItem, ...])
 *  4. 无参数（快捷键）：取 activeTextEditor
 *
 * 文件夹节点保持为文件夹路径，不展开为内部文件。
 */
function uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
    const seen = new Set<string>();
    return uris.filter(u => {
        if (seen.has(u.fsPath)) { return false; }
        seen.add(u.fsPath);
        return true;
    });
}

function resolveCommandUris(arg0: any, arg1: any): vscode.Uri[] {
    if (Array.isArray(arg1) && arg1.length > 0 && arg1[0] instanceof vscode.Uri) {
        return uniqueUris(arg1);
    }

    if (Array.isArray(arg1) && arg1.length > 0 && !(arg1[0] instanceof vscode.Uri)) {
        const uris: vscode.Uri[] = [];
        for (const item of arg1) {
            if (item.isDirectory === true && item.absolutePath) {
                uris.push(vscode.Uri.file(item.absolutePath));
            } else if (item.resourceUri instanceof vscode.Uri) {
                uris.push(item.resourceUri);
            }
        }
        return uniqueUris(uris);
    }

    if (arg0 instanceof vscode.Uri) {
        return [arg0];
    }
    if (arg0 && arg0.isDirectory === true && arg0.absolutePath) {
        return [vscode.Uri.file(arg0.absolutePath)];
    }
    if (arg0 && arg0.resourceUri instanceof vscode.Uri) {
        return [arg0.resourceUri];
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file') {
        return [editor.document.uri];
    }
    return [];
}

let _filteredTreeProvider: FilteredStatusTreeDataProvider | undefined;

async function isDirectoryPath(targetPath: string): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
        return Boolean(stat.type & vscode.FileType.Directory);
    } catch {
        return false;
    }
}

async function refreshCommandTargets(targetPaths: string[], fileStatusDecorator: FileStatusDecorator): Promise<void> {
    await Promise.all(targetPaths.map(async (targetPath) => {
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
            if (stat.type & vscode.FileType.Directory) {
                fileStatusDecorator.clearFolderCache(targetPath);
                await fileStatusDecorator.updateFolderStatus(targetPath);
                return;
            }

            fileStatusDecorator.clearFolderCache(path.dirname(targetPath));
            fileStatusDecorator.updateFileStatus(targetPath);
        } catch (error) {
            logError(`Failed to refresh command target ${targetPath}:`, error);
        }
    }));
}

async function executeBatchCommand(
    filePaths: string[],
    fileDir: string,
    buildArgs: (batch: string[]) => string | string[],
    commandName: string
): Promise<{ successCount: number; failCount: number; errors: any[] }> {
    const results = { successCount: 0, failCount: 0, errors: [] as any[] };

    if (filePaths.length > 1) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `${commandName} ${filePaths.length} files...`,
            cancellable: true
        }, async (progress, token) => {
            return executeBatchCommandWithProgress(filePaths, fileDir, buildArgs, commandName, results, progress, token);
        });
    } else {
        const cmdOrArgs = buildArgs(filePaths);
        logDebug(`${commandName} command:`, Array.isArray(cmdOrArgs) ? cmdOrArgs.join(' ') : cmdOrArgs);
        try {
            await executeSoscmd(cmdOrArgs as any, fileDir);
            results.successCount = filePaths.length;
        } catch (error) {
            results.failCount = filePaths.length;
            results.errors.push(error);
            vscode.window.showErrorMessage(`${commandName} failed: ${error}`, 'Show Output').then(choice => {
                if (choice === 'Show Output') { outputChannel.show(); }
            });
        }
    }

    return results;
}

async function executeBatchCommandWithProgress(
    filePaths: string[],
    fileDir: string,
    buildArgs: (batch: string[]) => string | string[],
    commandName: string,
    results: { successCount: number; failCount: number; errors: any[] },
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<void> {
    const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);
    logDebug(`${commandName}: Processing ${filePaths.length} files in ${totalBatches} batches`);

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        if (token.isCancellationRequested) {
            logDebug(`${commandName}: Cancelled by user after ${results.successCount} successes`);
            break;
        }

        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const cmdOrArgs = buildArgs(batch);

        logDebug(`${commandName} batch ${batchNum}/${totalBatches}:`, Array.isArray(cmdOrArgs) ? cmdOrArgs.join(' ') : cmdOrArgs);

        progress.report({
            message: `Processing batch ${batchNum}/${totalBatches}`,
            increment: (100 / totalBatches)
        });

        try {
            await executeSoscmd(cmdOrArgs as any, fileDir);
            results.successCount += batch.length;
        } catch (error) {
            results.failCount += batch.length;
            results.errors.push(error);
            logError(`${commandName} batch ${batchNum}/${totalBatches} failed: ${error}`);
        }
    }
}

function buildSosRevisionPath(filePath: string, revision: string): string {
    return `${filePath}/#/${revision}`;
}

async function executeOneFileDiff(
    filePath: string,
    pathnames: string[],
    extraVars: Record<string, string> = {}
): Promise<void> {
    const fileDir = path.dirname(filePath);
    const customCmd = getCommandConfig('diff');
    if (customCmd) {
        await executeSoscmd(replaceCommandVariables(customCmd, {
            filePath,
            filePath1: pathnames[0] || filePath,
            filePath2: pathnames[1] || '',
            ...extraVars
        }), fileDir);
        return;
    }
    await executeSoscmd(['diff', '-gui', ...pathnames], fileDir);
}

async function executePerFileDiffs(filePaths: string[]): Promise<{ successCount: number; failCount: number; cancelled: boolean }> {
    const results = { successCount: 0, failCount: 0, cancelled: false };

    const runOne = async (filePath: string): Promise<void> => {
        logDebug('Diff command:', filePath);
        await executeOneFileDiff(filePath, [filePath]);
    };

    if (filePaths.length === 1) {
        try {
            await runOne(filePaths[0]);
            results.successCount = 1;
        } catch (error) {
            results.failCount = 1;
            vscode.window.showErrorMessage(`Diff failed: ${error}`, 'Show Output').then(choice => {
                if (choice === 'Show Output') { outputChannel.show(); }
            });
        }
        return results;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Diff ${filePaths.length} files...`,
        cancellable: true
    }, async (progress, token) => {
        for (let i = 0; i < filePaths.length; i++) {
            if (token.isCancellationRequested) {
                results.cancelled = true;
                logDebug(`Diff: Cancelled by user after ${results.successCount} successes`);
                break;
            }

            const filePath = filePaths[i];
            progress.report({
                message: `${path.basename(filePath)} (${i + 1}/${filePaths.length})`,
                increment: 100 / filePaths.length
            });

            try {
                await runOne(filePath);
                results.successCount += 1;
            } catch (error) {
                results.failCount += 1;
                logError(`Diff failed for ${filePath}: ${error}`);
            }
        }
    });

    return results;
}

let fileStatusDecorator: FileStatusDecorator;

export function activate(context: vscode.ExtensionContext) {
    if (isDebugEnabled()) {
        logDebug('ClioSoft SOS Manager extension activating...');
    }

    const treeDataProvider = new FileVersionsTreeDataProvider();
    if (isDebugEnabled()) {
        logDebug('Tree data provider created');
    }

    vscode.window.registerTreeDataProvider('cliosoft-sos-manager.fileVersions', treeDataProvider);
    if (isDebugEnabled()) {
        logDebug('Tree view provider registered');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.refreshVersions', () => {
            if (isDebugEnabled()) {
                logDebug('Refresh versions command executed');
            }
            treeDataProvider.refresh();
        })
    );
    if (isDebugEnabled()) {
        logDebug('Refresh command registered');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.switchVersion', async (filePath: string | null, version: FileVersion | null) => {
            if (isDebugEnabled()) {
                logDebug(`Switch version command executed with filePath: ${filePath}, version: ${version?.id}`);
            }

            if (filePath && version) {
                if (isDebugEnabled()) {
                    logDebug(`Calling switchFileVersion for ${filePath} with version ${version.id}`);
                }

                const { switchFileVersion } = await import('./soscmd');
                const success = await switchFileVersion(filePath, version.id);

                if (success) {
                    const folder = path.dirname(filePath);
                    fileStatusDecorator.clearFolderCache(folder);

                    await revertFileInEditor(filePath);

                    await treeDataProvider.setFile(filePath);
                    fileStatusDecorator.updateFileStatus(filePath);

                    if (isDebugEnabled()) {
                        logDebug(`Version switch completed and UI refreshed`);
                    }
                }
            } else {
                logError(`Invalid parameters for switchVersion: filePath=${filePath}, version=${version}`);
            }
        })
    );
    if (isDebugEnabled()) {
        logDebug('Switch version command registered');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkout', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('checkout')) {
                logDebug('Checkout command is disabled');
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                logDebug('No file paths to process');
                return;
            }

            const filePaths = targetUris.map(u => u.fsPath);
            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(p => path.basename(p)).join(', ');

            logDebug('Working directory:', fileDir);
            logDebug('File names:', fileNames);

            const results = await executeBatchCommand(
                filePaths,
                fileDir,
                (batch) => {
                    const customCmd = getCommandConfig('checkout');
                    if (!customCmd) {
                        return ['co', '-Nlock', ...batch];
                    } else {
                        return replaceCommandVariables(customCmd, { filePath: batch });
                    }
                },
                'Checkout'
            );

            if (results.failCount === 0) {
                vscode.window.showInformationMessage(`Checked out: ${fileNames}`);
                logDebug('Checkout command completed successfully');
            } else {
                vscode.window.showWarningMessage(`Checked out ${results.successCount} files, ${results.failCount} failed.`);
                logDebug(`Checkout command completed with ${results.successCount} successes and ${results.failCount} failures`);
            }

            await refreshCommandTargets(filePaths, fileStatusDecorator);
            for (const fp of filePaths) { await revertFileInEditor(fp); }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.checkin', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('checkin')) {
                logDebug('Checkin command is disabled');
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                logDebug('No file paths to process');
                return;
            }

            const filePaths = targetUris.map(u => u.fsPath);

            const comments = await vscode.window.showInputBox({
                prompt: 'Enter check-in comments',
                placeHolder: 'Describe your changes...',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Comments cannot be empty';
                    }
                    return null;
                }
            });

            if (!comments) {
                return;
            }

            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(p => path.basename(p)).join(', ');

            logDebug('Working directory:', fileDir);
            logDebug('File names:', fileNames);

            const results = await executeBatchCommand(
                filePaths,
                fileDir,
                (batch) => {
                    const customCmd = getCommandConfig('checkin');
                    if (!customCmd) {
                        return ['ci', `-aLog=${comments}`, ...batch];
                    } else {
                        return replaceCommandVariables(customCmd, { filePath: batch, comments });
                    }
                },
                'Checkin'
            );

            if (results.failCount === 0) {
                vscode.window.showInformationMessage(`Checked in: ${fileNames}`);
                logDebug('Checkin command completed successfully');
            } else {
                vscode.window.showWarningMessage(`Checked in ${results.successCount} files, ${results.failCount} failed.`);
                logDebug(`Checkin command completed with ${results.successCount} successes and ${results.failCount} failures`);
            }

            await refreshCommandTargets(filePaths, fileStatusDecorator);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.diff', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('diff')) {
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                return;
            }

            const filePaths = targetUris.map(u => u.fsPath);
            if (isDebugEnabled()) {
                logDebug(`Diff command executed for ${filePaths.length} file(s)`);
            }

            const results = await executePerFileDiffs(filePaths);
            if (filePaths.length === 1) {
                return;
            }
            if (results.cancelled) {
                vscode.window.showWarningMessage(`Diff cancelled: ${results.successCount} succeeded, ${results.failCount} failed.`);
            } else if (results.failCount === 0) {
                vscode.window.showInformationMessage(`Diff completed for ${results.successCount} files.`);
            } else {
                vscode.window.showWarningMessage(`Diff completed: ${results.successCount} succeeded, ${results.failCount} failed.`, 'Show Output').then(choice => {
                    if (choice === 'Show Output') { outputChannel.show(); }
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.diffRevisions', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('diff')) {
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                return;
            }
            if (targetUris.length > 1) {
                vscode.window.showWarningMessage('Diff Two SOS Revisions works on one file at a time.');
                return;
            }

            const filePath = targetUris[0].fsPath;
            const versions = await getFileVersions(filePath);
            if (versions.length === 0) {
                vscode.window.showWarningMessage(`No SOS revisions found for ${path.basename(filePath)}.`);
                return;
            }

            const picked = await vscode.window.showQuickPick(
                versions.map(version => ({
                    label: `r${version.id}`,
                    description: `${version.ciBy}  ${version.ciTime}`,
                    detail: version.changeSummary,
                    version
                })),
                {
                    title: `Diff revisions of ${path.basename(filePath)}`,
                    placeHolder: 'Select 1 revision (vs workarea) or 2 revisions',
                    canPickMany: true,
                    matchOnDescription: true,
                    matchOnDetail: true
                }
            );
            if (!picked || picked.length === 0) {
                return;
            }
            if (picked.length > 2) {
                vscode.window.showWarningMessage('Select at most two SOS revisions.');
                return;
            }

            const selected = picked
                .slice()
                .sort((a, b) => Number(a.version.id) - Number(b.version.id));
            const revision1 = selected[0].version.id;
            const revision2 = selected[1]?.version.id;
            const pathnames = revision2
                ? [buildSosRevisionPath(filePath, revision1), buildSosRevisionPath(filePath, revision2)]
                : [filePath, buildSosRevisionPath(filePath, revision1)];

            if (isDebugEnabled()) {
                logDebug(`Diff revisions: ${pathnames.join('  ')}`);
            }

            try {
                await executeOneFileDiff(filePath, pathnames, {
                    revision1,
                    revision2: revision2 || ''
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Diff revisions failed: ${error}`, 'Show Output').then(choice => {
                    if (choice === 'Show Output') { outputChannel.show(); }
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.discard', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('discard')) {
                logDebug('Discard command is disabled');
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                logDebug('No file paths to process');
                return;
            }

            const filePaths = targetUris.map(u => u.fsPath);

            const selectedOption = await vscode.window.showQuickPick([
                { label: 'Yes (discard all changes)', value: true },
                { label: 'No (keep local changes)', value: false }
            ], {
                placeHolder: 'Do you want to use -F parameter to discard all changes?',
                title: 'Discard Changes'
            });

            if (!selectedOption) {
                return;
            }

            const useForce = selectedOption.value;

            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(p => path.basename(p)).join(', ');

            logDebug('Working directory:', fileDir);
            logDebug('File names:', fileNames);

            const results = await executeBatchCommand(
                filePaths,
                fileDir,
                (batch) => {
                    const customCmd = getCommandConfig('discard');
                    if (!customCmd) {
                        return useForce ? ['discard', '-F', ...batch] : ['discard', ...batch];
                    } else {
                        return replaceCommandVariables(customCmd, { filePath: batch, useForce: useForce ? '-F' : '' });
                    }
                },
                'Discard'
            );

            if (results.failCount === 0) {
                vscode.window.showInformationMessage(`Discarded: ${fileNames}`);
                logDebug('Discard command completed successfully');
            } else {
                vscode.window.showWarningMessage(`Discarded ${results.successCount} files, ${results.failCount} failed.`);
                logDebug(`Discard command completed with ${results.successCount} successes and ${results.failCount} failures`);
            }

            await refreshCommandTargets(filePaths, fileStatusDecorator);
            for (const fp of filePaths) { await revertFileInEditor(fp); }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.update', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('update')) {
                logDebug('Update command is disabled');
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                logDebug('No file paths to update');
                return;
            }

            const targetPaths = targetUris.map(u => u.fsPath);
            const targetTypes = await Promise.all(targetPaths.map(async targetPath => ({
                path: targetPath,
                isDirectory: await isDirectoryPath(targetPath)
            })));
            const fileTargets = targetTypes.filter(t => !t.isDirectory).map(t => t.path);
            const folderTargets = targetTypes.filter(t => t.isDirectory).map(t => t.path);
            const fileDir = folderTargets.length === 1 && fileTargets.length === 0
                ? path.dirname(folderTargets[0])
                : path.dirname(targetPaths[0]);
            const targetNames = targetPaths.map(p => path.basename(p)).join(', ');

            let results: { successCount: number; failCount: number; errors: any[] };
            if (folderTargets.length === 1 && fileTargets.length === 0) {
                const customCmd = getCommandConfig('update');
                const folderName = path.basename(folderTargets[0]);
                const cmdOrArgs = customCmd
                    ? replaceCommandVariables(customCmd, { filePath: folderTargets[0] })
                    : ['updatesel', folderName];
                results = await executeBatchCommand([folderTargets[0]], fileDir, () => cmdOrArgs, 'Update');
            } else if (folderTargets.length > 0) {
                vscode.window.showWarningMessage('SOS update only supports one selected folder at a time. Please update folders one by one.');
                return;
            } else {
                results = await executeBatchCommand(
                    fileTargets,
                    fileDir,
                    (batch) => {
                        const customCmd = getCommandConfig('update');
                        if (!customCmd) {
                            return ['updatesel', ...batch];
                        } else {
                            return replaceCommandVariables(customCmd, { filePath: batch });
                        }
                    },
                    'Update'
                );
            }

            if (results.failCount === 0) {
                vscode.window.showInformationMessage(`Updated: ${targetNames}`);
                logDebug('Update command completed successfully');
            } else {
                vscode.window.showWarningMessage(`Updated ${results.successCount} files or folders, ${results.failCount} failed.`);
                logDebug(`Update command completed with ${results.successCount} successes and ${results.failCount} failures`);
            }

            await refreshCommandTargets(targetPaths, fileStatusDecorator);
            for (const fp of targetPaths) { await revertFileInEditor(fp); }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.createFile', async (arg0: any, arg1: any) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }
            if (!isCommandEnabled('createFile')) {
                logDebug('Create file command is disabled');
                return;
            }

            const targetUris = resolveCommandUris(arg0, arg1);
            if (targetUris.length === 0) {
                logDebug('No file paths to create');
                return;
            }

            const filePaths = targetUris.map(u => u.fsPath);
            const fileDir = path.dirname(filePaths[0]);
            const fileNames = filePaths.map(p => path.basename(p)).join(', ');

            logDebug('Working directory:', fileDir);
            logDebug('File names:', fileNames);

            const results = await executeBatchCommand(
                filePaths,
                fileDir,
                (batch) => {
                    const customCmd = getCommandConfig('createFile');
                    if (!customCmd) {
                        return ['create', ...batch];
                    } else {
                        return replaceCommandVariables(customCmd, { filePath: batch });
                    }
                },
                'Create file'
            );

            if (results.failCount === 0) {
                vscode.window.showInformationMessage(`SOS created: ${fileNames}`);
                logDebug('Create file command completed successfully');
            } else {
                vscode.window.showWarningMessage(`SOS created ${results.successCount} files, ${results.failCount} failed.`);
                logDebug(`Create file command completed with ${results.successCount} successes and ${results.failCount} failures`);
            }

            await refreshCommandTargets(filePaths, fileStatusDecorator);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.officeOpen', async (uri: vscode.Uri) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }

            if (!isCommandEnabled('officeOpen')) {
                return;
            }

            let filePath: string;
            if (uri) {
                filePath = uri.fsPath;
            } else {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }
                filePath = editor.document.uri.fsPath;
            }

            const fileDir = path.dirname(filePath);

            if (isDebugEnabled()) {
                logDebug(`Office open command executed for: ${filePath}`);
            }

            try {
                let command = getCommandConfig('officeOpen');
                if (!command) {
                    command = `soffice "${filePath}"`;
                } else {
                    command = replaceCommandVariables(command, { filePath });
                }

                await execAsync(command, { cwd: fileDir });
                vscode.window.showInformationMessage(`Opened file in office application`);
            } catch (error) {
                const errorMsg = `Failed to open file: ${error instanceof Error ? error.message : String(error)}`;
                logError(errorMsg);
                showSosError(errorMsg);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.rebuildCtags', async (uri: vscode.Uri) => {
            if (!isPlatformSupported()) {
                await showPlatformWarning();
                return;
            }

            if (!isCommandEnabled('rebuildCtags')) {
                return;
            }

            let filePath: string;
            if (uri) {
                filePath = uri.fsPath;
            } else {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }
                filePath = editor.document.uri.fsPath;
            }

            const fileDir = path.dirname(filePath);

            if (isDebugEnabled()) {
                logDebug(`Rebuild ctags command executed for: ${filePath}`);
            }

            try {
                let command = getCommandConfig('rebuildCtags');
                if (!command) {
                    const projRoot = process.env.PROJ_ROOT || fileDir;
                    command = `cd "${projRoot}" && ctags -R --fields=+nKz -f .vscode/.tags --langmap=SystemVerilog:+.v+.sv -R --links=yes ./design_data/rtl ./design_data/testbench ./ref_ip`;
                } else {
                    command = replaceCommandVariables(command, { filePath });
                }

                vscode.window.showInformationMessage('Rebuilding ctags...');
                await execAsync(command, { cwd: fileDir });
                vscode.window.showInformationMessage('Ctags rebuilt successfully');
            } catch (error) {
                const errorMsg = `Failed to rebuild ctags: ${error instanceof Error ? error.message : String(error)}`;
                logError(errorMsg);
                showSosError(errorMsg);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.toggleRefresh', () => {
            fileStatusDecorator.toggleRefresh();
        })
    );

    const NO_EDITOR_HINT = 'Shortcut not available for this file type. Please use the right-click context menu in Explorer instead.';

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.quickCheckout', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(NO_EDITOR_HINT);
                return;
            }
            await vscode.commands.executeCommand(
                'cliosoft-sos-manager.checkout',
                editor.document.uri,
                [editor.document.uri]
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.quickCheckin', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(NO_EDITOR_HINT);
                return;
            }
            await vscode.commands.executeCommand(
                'cliosoft-sos-manager.checkin',
                editor.document.uri,
                [editor.document.uri]
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cliosoft-sos-manager.quickDiscard', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(NO_EDITOR_HINT);
                return;
            }
            await vscode.commands.executeCommand(
                'cliosoft-sos-manager.discard',
                editor.document.uri,
                [editor.document.uri]
            );
        })
    );

    fileStatusDecorator = new FileStatusDecorator();

    let hasDiskCache = false;
    if (isDiskCacheEnabled()) {
        const diskCachePath = path.join(context.globalStorageUri.fsPath, 'statusCache.json');
        fileStatusDecorator.setDiskCachePath(diskCachePath);
        hasDiskCache = fileStatusDecorator.loadDiskCache();
    }

    vscode.workspace.textDocuments.forEach(doc => {
        if (doc.uri.scheme !== 'file') { return; }
        const filePath = doc.uri.fsPath;
        if (filePath) {
            fileStatusDecorator.updateFileStatus(filePath);
        }
    });
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
        treeDataProvider.setFile(vscode.window.activeTextEditor.document.uri.fsPath);
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let filteredTreeProvider: FilteredStatusTreeDataProvider | undefined;
    let filteredTreeView: vscode.TreeView<any> | undefined;

    function revealInFilteredTree(filePath: string): void {
        if (!filteredTreeProvider || !filteredTreeView || !filteredTreeView.visible) { return; }
        if (!filteredTreeProvider.hasFile(filePath)) { return; }
        const item = filteredTreeProvider.findItem(filePath);
        if (item) {
            filteredTreeView.reveal(item, { select: true, focus: false, expand: false });
        }
    }

    if (workspaceRoot) {
        filteredTreeProvider = new FilteredStatusTreeDataProvider(
            workspaceRoot,
            fileStatusDecorator.fileStatusCache
        );
        _filteredTreeProvider = filteredTreeProvider;
        fileStatusDecorator.setFilteredTreeProvider(filteredTreeProvider);

        filteredTreeView = vscode.window.createTreeView(
            'cliosoft-sos-manager.filteredStatus',
            { treeDataProvider: filteredTreeProvider, showCollapseAll: true, canSelectMany: true }
        );
        context.subscriptions.push(filteredTreeView);

        context.subscriptions.push(
            fileStatusDecorator.onDidUpdateStatus(() => {
                if (!filteredTreeView?.visible) {
                    return;
                }
                filteredTreeProvider!.rebuild();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('cliosoft-sos-manager.refreshFilteredStatus', async () => {
                const count = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Scanning workspace for SOS status...',
                        cancellable: true
                    },
                    async (progress, token) => {
                        return fileStatusDecorator.performFullWorkspaceScan(
                            workspaceRoot, progress, token
                        );
                    }
                );

                if (count === undefined) {
                    vscode.window.showWarningMessage('SOS status scan failed or was cancelled. See ClioSoft SOS output for details.', 'Show Output').then(choice => {
                        if (choice === 'Show Output') { outputChannel.show(); }
                    });
                } else {
                    vscode.window.showInformationMessage(`SOS status scan complete: ${count} changed files found.`);
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('cliosoft-sos-manager.showOutputChannel', () => {
                outputChannel.show();
            })
        );

        context.subscriptions.push(
            filteredTreeView.onDidChangeVisibility(e => {
                if (e.visible && filteredTreeProvider!.isEmpty() && !hasDiskCache) {
                    vscode.commands.executeCommand('cliosoft-sos-manager.refreshFilteredStatus');
                }
            })
        );
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.uri.scheme !== 'file') { return; }
            if (document === vscode.window.activeTextEditor?.document) {
                return;
            }
            fileStatusDecorator.updateFileStatus(document.uri.fsPath);
        })
    );

    let lastActiveTab: string | undefined;

    function refreshActiveEditor(filePath: string): void {
        fileStatusDecorator.updatePathStatus(filePath);
        treeDataProvider.setFile(filePath);
        revealInFilteredTree(filePath);
    }

    const tabChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document && editor.document.uri.scheme === 'file') {
            const currentFile = editor.document.uri.fsPath;
            if (currentFile !== lastActiveTab) {
                lastActiveTab = currentFile;
                refreshActiveEditor(currentFile);
            }
        }
    });
    context.subscriptions.push(tabChangeListener);

    if (vscode.window.tabGroups && vscode.window.tabGroups.onDidChangeTabs) {
        const tabGroupsListener = vscode.window.tabGroups.onDidChangeTabs(() => {
            try {
                const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
                if (activeTab && activeTab.input) {
                    let filePath: string | undefined;

                    const input = activeTab.input as any;
                    if (input.uri && input.uri.scheme === 'file') {
                        filePath = input.uri.fsPath;
                    }

                    if (filePath && filePath !== lastActiveTab) {
                        lastActiveTab = filePath;
                        refreshActiveEditor(filePath);

                        if (isDebugEnabled()) {
                            logDebug(`Active tab changed to: ${filePath}`);
                        }
                    }
                }
            } catch (error) {
                if (isDebugEnabled()) {
                    logError(`Failed to check active tab:`, error);
                }
            }
        });
        context.subscriptions.push(tabGroupsListener);
    } else {
        if (isDebugEnabled()) {
            logDebug('tabGroups.onDidChangeTabs not available, using fallback polling');
        }

        const tabChangeInterval = setInterval(async () => {
            try {
                const tabGroups = vscode.window.tabGroups;
                if (tabGroups && tabGroups.activeTabGroup) {
                    const activeTab = tabGroups.activeTabGroup.activeTab;
                    if (activeTab && activeTab.input) {
                        let filePath: string | undefined;

                        const input = activeTab.input as any;
                        if (input.uri && input.uri.scheme === 'file') {
                            filePath = input.uri.fsPath;
                        }

                        if (filePath && filePath !== lastActiveTab) {
                            lastActiveTab = filePath;
                            refreshActiveEditor(filePath);

                            if (isDebugEnabled()) {
                                logDebug(`Active tab changed to: ${filePath}`);
                            }
                        }
                    }
                }
            } catch (error) {
                if (isDebugEnabled()) {
                    logError(`Failed to check active tab:`, error);
                }
            }
        }, TAB_POLLING_INTERVAL);

        context.subscriptions.push({
            dispose: () => {
                clearInterval(tabChangeInterval);
            }
        });
    }

    const isLinux = process.platform === 'linux';

    if (!isLinux) {
        vscode.window.showWarningMessage('This extension is designed to run on Linux only. Some features may not work correctly.');
    }

    const statusRefreshInterval = setInterval(async () => {
        if (!isLinux) {
            return;
        }

        if (!vscode.window.state.focused) {
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document && activeEditor.document.uri.scheme === 'file') {
            fileStatusDecorator.updateFileStatus(activeEditor.document.uri.fsPath);
        }
    }, getStatusRefreshInterval());

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            fileStatusDecorator.clearCache();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.uri.scheme !== 'file') { return; }
            const filePath = document.uri.fsPath;
            if (isDebugEnabled()) {
                logDebug(`File saved: ${filePath}`);
            }
            if (fileStatusDecorator) {
                const folderPath = path.dirname(filePath);
                fileStatusDecorator.clearFolderCache(folderPath);
                fileStatusDecorator.updateFileStatus(filePath);
            }
        })
    );

    context.subscriptions.push({
        dispose: () => {
            clearInterval(statusRefreshInterval);
        }
    });

    if (isDebugEnabled()) {
        logDebug('ClioSoft SOS Manager extension activated!');
    }
}

export function deactivate() {
    logDebug('ClioSoft SOS Manager extension deactivated!');

    if (fileStatusDecorator) {
        fileStatusDecorator.dispose();
    }
}
