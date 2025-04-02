import * as vscode from "vscode";
import { simpleGit, SimpleGit } from "simple-git";

interface GitStatus {
  path: string;
  staged: boolean;
  modified: boolean;
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new GitCommitGeneratorViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "git-commit-generator-view",
      provider
    )
  );
}

class GitCommitGeneratorViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _git?: SimpleGit;
  private _currentDirectory?: string;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "updateDirectory":
          await this.updateDirectory(data.value);
          break;
        case "generateCommitMessage":
          await this.generateCommitMessage(
            data.selectedFiles,
            data.userInstructions
          );
          break;
      }
    });

    // Set initial directory if workspace is available
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      this._currentDirectory = vscode.workspace.workspaceFolders[0].uri.fsPath;
      this.updateDirectory(this._currentDirectory);
    }
  }

  private async updateDirectory(directory: string) {
    try {
      if (!directory) {
        if (
          vscode.workspace.workspaceFolders &&
          vscode.workspace.workspaceFolders.length > 0
        ) {
          directory = vscode.workspace.workspaceFolders[0].uri.fsPath;
        } else {
          this._view?.webview.postMessage({
            type: "error",
            message: "No directory specified and no workspace folder found",
          });
          return;
        }
      }

      this._git = simpleGit(directory);
      this._currentDirectory = directory;

      // Check if directory is a git repository
      const isRepo = await this._git.checkIsRepo();
      if (!isRepo) {
        this._view?.webview.postMessage({
          type: "error",
          message: "Selected directory is not a git repository",
        });
        return;
      }

      // Get status of all files
      const status = await this._git.status();
      const modifiedFiles: GitStatus[] = [
        ...status.modified.map((path) => ({
          path,
          staged: false,
          modified: true,
        })),
        ...status.not_added.map((path) => ({
          path,
          staged: false,
          modified: true,
        })),
        ...status.created.map((path) => ({
          path,
          staged: false,
          modified: true,
        })),
      ];

      this._view?.webview.postMessage({
        type: "updateFiles",
        files: modifiedFiles,
      });
    } catch (error) {
      this._view?.webview.postMessage({
        type: "error",
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  }

  private async generateCommitMessage(
    selectedFiles: string[],
    userInstructions: string
  ) {
    try {
      if (!this._git || !this._currentDirectory) {
        throw new Error("Git repository not initialized");
      }

      if (selectedFiles.length === 0) {
        throw new Error("No files selected");
      }

      // Stage selected files
      await this._git.add(selectedFiles);

      // Get the diff for staged files
      const diff = await this._git.diff(["--staged"]);
      if (!diff) {
        throw new Error("No staged changes found");
      }

      const message = this.generateCommitMessageFromDiff(
        diff,
        userInstructions
      );
      this._view?.webview.postMessage({
        type: "commitMessage",
        message,
      });
    } catch (error) {
      this._view?.webview.postMessage({
        type: "error",
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  }

  private generateCommitMessageFromDiff(
    diff: string,
    userInstructions: string
  ): string {
    const lines = diff.split("\n");
    const changedFiles = new Set<string>();
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith("+++") && line.length > 4) {
        const file = line.substring(4);
        if (file !== "/dev/null") {
          changedFiles.add(file.split("/").pop() || "");
        }
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }

    const filesChanged = Array.from(changedFiles);
    let baseMessage = "";

    if (userInstructions) {
      baseMessage = `${userInstructions}: `;
    } else {
      baseMessage = "Update: ";
    }

    if (filesChanged.length === 0) {
      return `${baseMessage}Changes in repository`;
    }

    if (filesChanged.length === 1) {
      return `${baseMessage}Changes in ${filesChanged[0]} (+${additions} -${deletions})`;
    }

    return `${baseMessage}Changes in multiple files (${filesChanged
      .slice(0, 3)
      .join(", ")}${
      filesChanged.length > 3 ? "..." : ""
    }) (+${additions} -${deletions})`;
  }

  private _getHtmlForWebview() {
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Git Commit Generator</title>
            <style>
                * {
                    box-sizing: border-box; /* Include padding and borders in element dimensions */
                }

                body {
                    padding: 15px;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    display: flex;
                    flex-direction: column;
                    height: 100vh; /* Full viewport height */
                    margin: 0;
                    overflow-x: hidden; /* Disable horizontal scrolling */
                }

                .header {
                    font-size: 1.2em;
                    font-weight: bold;
                    margin-bottom: 15px;
                }

                .input-group {
                    display: flex;
                    gap: 5px;
                    margin-bottom: 15px;
                }

                input, textarea, button {
                    width: 100%; /* Ensure full width */
                    max-width: 100%; /* Prevent exceeding container width */
                    padding: 5px;
                    margin: 0; /* Remove unnecessary margins */
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                }

                button {
                    padding: 5px 10px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    cursor: pointer;
                }

                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }

                .file-list {
                    margin: 15px 0;
                    max-height: 200px; /* Limit height of file list */
                    overflow-y: auto; /* Enable scrolling within the file list */
                    overflow-x: hidden; /* Disable horizontal scrolling */
                }

                .file-item {
                    display: flex;
                    align-items: center;
                    padding: 5px;
                }

                .main-content {
                    flex: 1; /* Take up remaining vertical space */
                    overflow-y: auto; /* Enable vertical scrolling if needed */
                    overflow-x: hidden; /* Disable horizontal scrolling */
                }

                .footer {
                    margin-top: auto; /* Push footer to the bottom */
                    padding: 15px 0;
                    width: 100%; /* Ensure full width */
                }
            </style>
        </head>
        <body>
            <div class="main-content">
                <div class="header">Git Commit Generator <span style="font-size: 0.8em;">✨</span></div>
                <div class="input-group">
                    <input type="text" id="directory" placeholder="Enter directory path or leave empty for workspace">
                    <button id="updateBtn">📂 Update Directory</button>
                </div>
                <div class="error-message" id="directoryError"></div>
                <div class="file-list" id="fileList"></div>
                <div style="margin: 20px 0;">
                    <label>User Instructions:</label>
                    <textarea id="userInstructions" rows="3" placeholder="Enter instructions for commit message generation..."></textarea>
                </div>
                <div style="margin: 20px 0;">
                    <label>Commit Message:</label>
                    <textarea id="commitMessage" rows="5" readonly placeholder="Generated commit message will appear here..."></textarea>
                </div>
            </div>
            <div class="footer">
                <button id="generateBtn" style="width: 100%;">✍️ Generate Commit Message</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                let selectedFiles = new Set();
    
                // Update button click handler
                document.getElementById('updateBtn').addEventListener('click', () => {
                    const directory = document.getElementById('directory').value;
                    vscode.postMessage({
                        type: 'updateDirectory',
                        value: directory
                    });
                });
    
                // Generate button click handler
                document.getElementById('generateBtn').addEventListener('click', () => {
                    const userInstructions = document.getElementById('userInstructions').value;
                    vscode.postMessage({
                        type: 'generateCommitMessage',
                        selectedFiles: Array.from(selectedFiles),
                        userInstructions: userInstructions
                    });
                });
    
                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'updateFiles':
                            updateFileList(message.files);
                            break;
                        case 'commitMessage':
                            document.getElementById('commitMessage').value = message.message;
                            break;
                        case 'error':
                            document.getElementById('directoryError').innerText = message.message;
                            break;
                    }
                });
    
                function updateFileList(files) {
                    const fileList = document.getElementById('fileList');
                    fileList.innerHTML = '';
                    selectedFiles.clear();
    
                    const selectAllDiv = document.createElement('div');
                    selectAllDiv.className = 'file-item';
                    selectAllDiv.innerHTML = \`
                        <input type="checkbox" id="selectAll">
                        <label for="selectAll">Select All</label>
                    \`;
                    fileList.appendChild(selectAllDiv);
    
                    const selectAllCheckbox = selectAllDiv.querySelector('#selectAll');
                    selectAllCheckbox.addEventListener('change', (e) => {
                        const checkboxes = fileList.querySelectorAll('input[type="checkbox"]');
                        checkboxes.forEach(checkbox => {
                            if (checkbox !== selectAllCheckbox) {
                                checkbox.checked = selectAllCheckbox.checked;
                                const filePath = checkbox.dataset.path;
                                if (selectAllCheckbox.checked) {
                                    selectedFiles.add(filePath);
                                } else {
                                    selectedFiles.delete(filePath);
                                }
                            }
                        });
                    });
    
                    files.forEach(file => {
                        const div = document.createElement('div');
                        div.className = 'file-item';
                        div.innerHTML = \`
                            <input type="checkbox" data-path="\${file.path}">
                            <label>\${file.path}</label>
                        \`;
                        fileList.appendChild(div);
    
                        const checkbox = div.querySelector('input');
                        checkbox.addEventListener('change', (e) => {
                            if (e.target.checked) {
                                selectedFiles.add(file.path);
                            } else {
                                selectedFiles.delete(file.path);
                                selectAllCheckbox.checked = false;
                            }
                        });
                    });
                }
            </script>
        </body>
        </html>`;
  }
}

export function deactivate() {}
