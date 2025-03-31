import * as vscode from 'vscode';
import { simpleGit, SimpleGit } from 'simple-git';

interface GitStatus {
    path: string;
    staged: boolean;
    modified: boolean;
}

export function activate(context: vscode.ExtensionContext) {
    console.log("Inside activate");
    let disposable = vscode.commands.registerCommand('comm-it.generate', async () => {
        try {
            // Get workspace folder or ask for directory
            let targetDir: string | undefined;
            
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                targetDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
            } else {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: 'Select Repository Directory'
                });

                if (result && result.length > 0) {
                    targetDir = result[0].fsPath;
                }
            }

            if (!targetDir) {
                vscode.window.showErrorMessage('No directory selected');
                return;
            }

            const git: SimpleGit = simpleGit(targetDir);

            // Check if directory is a git repository
            const isRepo = await git.checkIsRepo();
            if (!isRepo) {
                vscode.window.showErrorMessage('Selected directory is not a git repository');
                return;
            }

            // Get status of all files
            const status = await git.status();
            const modifiedFiles: GitStatus[] = [
                ...status.modified.map(path => ({ path, staged: false, modified: true })),
                ...status.not_added.map(path => ({ path, staged: false, modified: true })),
                ...status.created.map(path => ({ path, staged: false, modified: true }))
            ];

            if (modifiedFiles.length === 0) {
                vscode.window.showInformationMessage('No modified files found');
                return;
            }

            // Add "Select All" option
            const selectAllOption = {
                label: "$(check-all) Select All",
                kind: vscode.QuickPickItemKind.Separator,
                alwaysShow: true
            };

            // Show quick pick for file selection
            const quickPick = vscode.window.createQuickPick();
            quickPick.items = [
                selectAllOption,
                ...modifiedFiles.map(file => ({
                    label: file.path,
                    description: file.staged ? 'Staged' : 'Not staged',
                    picked: file.staged
                }))
            ];
            quickPick.canSelectMany = true;
            quickPick.placeholder = 'Select files to stage and commit (including Select All option)';

            let selectedFiles: vscode.QuickPickItem[] = [];
            
            quickPick.onDidChangeSelection(items => {
                const hasSelectAll = items.some(item => item.label === "$(check-all) Select All");
                if (hasSelectAll) {
                    // Select all files except the "Select All" option
                    quickPick.selectedItems = quickPick.items.filter(item => item.label !== "$(check-all) Select All");
                }
                selectedFiles = items.filter(item => item.label !== "$(check-all) Select All");
            });

            quickPick.onDidAccept(async () => {
                quickPick.hide();
                
                if (selectedFiles.length === 0) {
                    vscode.window.showInformationMessage('No files selected');
                    return;
                }

                // Stage selected files
                await git.add(selectedFiles.map(item => item.label));

                // Get the diff for staged files
                const diff = await git.diff(['--staged']);
                if (!diff) {
                    vscode.window.showInformationMessage('No staged changes found');
                    return;
                }

                // Generate a basic commit message based on the diff
                const message = generateCommitMessage(diff);

                // Show the generated message in an input box for editing
                const commitMessage = await vscode.window.showInputBox({
                    value: message,
                    prompt: 'Edit the generated commit message',
                    validateInput: text => {
                        return text.length === 0 ? 'Commit message cannot be empty' : null;
                    }
                });

                if (commitMessage) {
                    await git.commit(commitMessage);
                    vscode.window.showInformationMessage('Changes committed successfully!');
                }
            });

            quickPick.show();

        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
        }
    });

    context.subscriptions.push(disposable);
}

function generateCommitMessage(diff: string): string {
    // Enhanced commit message generation logic
    const lines = diff.split('\n');
    const changedFiles = new Set<string>();
    let additions = 0;
    let deletions = 0;
    
    for (const line of lines) {
        if (line.startsWith('+++') && line.length > 4) {
            const file = line.substring(4);
            if (file !== '/dev/null') {
                changedFiles.add(file.split('/').pop() || '');
            }
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            deletions++;
        }
    }

    const filesChanged = Array.from(changedFiles);
    if (filesChanged.length === 0) {
        return 'Update: Changes in repository';
    }

    if (filesChanged.length === 1) {
        return `Update: Changes in ${filesChanged[0]} (+${additions} -${deletions})`;
    }

    return `Update: Changes in multiple files (${filesChanged.slice(0, 3).join(', ')}${filesChanged.length > 3 ? '...' : ''}) (+${additions} -${deletions})`;
}

export function deactivate() {}