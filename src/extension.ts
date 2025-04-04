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
        // Simulate an API call to the backend
        const backendResponse = await this.callBackendAPI(diff, userInstructions);

        // Send the generated commit message back to the webview
        this._view?.webview.postMessage({
            type: "commitMessage",
            message: backendResponse,
        });
    } catch (error) {
        this._view?.webview.postMessage({
            type: "error",
            message:
                error instanceof Error ? error.message : "Unknown error occurred",
        });
    }
}


private async callBackendAPI(diff: string, userInstructions: string): Promise<string> {
  const url = 'http://127.0.0.1:8000/generate';
  const DELIMITER = "-----END_OF_DIFF-----"; // Unique delimiter

  try {
    // Concatenate diff and userInstructions with a unique delimiter
    const concatenatedText = `${diff}${DELIMITER}${userInstructions}`;

    // Perform the POST request using fetch
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain', // Specify plain text content type
      },
      body: concatenatedText, // Send the concatenated string as the body
    });

    // Check if the response status is OK (status code 200-299)
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Parse and return the response as text
    const result = await response.text();
    return result;
  } catch (error) {
    // Handle any errors that occurred during the request
    console.error('Error calling backend API:', error);
    throw error; // Re-throw the error to propagate it further if needed
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
        <title>Commit-it</title>
        <style>
            body {
                padding: 15px;
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                display: flex;
                flex-direction: column;
                height: 100vh;
                margin: 0;
                box-sizing: border-box;
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
            input, textarea {
                width: 100%;
                min-height: 30px; /* Minimum height for inputs */
                max-height: 200px; /* Maximum height for inputs */
                padding: 5px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                resize: vertical; /* Allow vertical resizing */
                box-sizing: border-box;
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
                max-height: 200px;
                overflow-y: auto;
                border: 1px solid var(--vscode-editorWidget-border);
                border-radius: 4px;
                padding: 10px;
            }
            .file-item {
                display: grid;
                grid-template-columns: 1fr auto auto; /* File name, status, checkbox */
                align-items: center;
                gap: 10px;
                padding: 5px 0;
            }
            .file-item label {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .file-status {
                font-size: 0.8em;
                padding: 2px 5px;
                border-radius: 3px;
                white-space: nowrap;
            }
            .status-modified {
                background: #ffcccc;
                color: #cc0000;
            }
            .status-staged {
                background: #ccffcc;
                color: #008000;
            }
            .status-untracked {
                background: #ffffcc;
                color: #808000;
            }
            .main-content {
                flex: 1;
                overflow-y: auto;
            }
            .footer {
                margin-top: auto;
                padding: 15px 0;
            }
            /* Scrollbar styling */
            .file-list::-webkit-scrollbar {
                width: 8px;
            }
            .file-list::-webkit-scrollbar-thumb {
                background: var(--vscode-scrollbarSlider-background);
                border-radius: 4px;
            }
            .file-list::-webkit-scrollbar-thumb:hover {
                background: var(--vscode-scrollbarSlider-hoverBackground);
            }
            /* Collapsible Sections */
            .collapsible-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: pointer;
                margin: 15px 0;
            }
            .collapsible-header h3 {
                margin: 0;
                font-size: 1em;
            }
            .collapsible-content {
                display: none; /* Initially hidden */
                margin-bottom: 15px;
            }
            .collapsible-content.active {
                display: block; /* Show when active */
            }
            .toggle-icon {
                font-size: 1.2em;
                transition: transform 0.3s ease;
            }
            .toggle-icon.collapsed {
                transform: rotate(90deg); /* Rotate arrow when collapsed */
            }
            /* Generating Animation */
            #generatingAnimation {
                display: flex;
                text-align: center;
                margin-top: 10px;
            }
            .loader {
                border: 4px solid #f3f3f3; /* Light grey */
                border-top: 4px solid var(--vscode-button-background); /* Primary color */
                border-radius: 50%;
                width: 10px;
                height: 10px;
                animation: spin 1s linear infinite;
                display: inline-block;
                margin-left: 10px;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    </head>
    <body>
        <div class="main-content">
            <div class="header">Git Commit Generator</div>
            <div class="input-group">
                <input type="text" id="directory" placeholder="Enter directory path or leave empty for workspace">
                <button id="updateBtn">Update</button>
            </div>
            <!-- Collapsible User Instructions -->
            <div class="collapsible-header" id="userInstructionsHeader">
                <h3>Generation Instructions (Optional)</h3>
                <span class="toggle-icon" id="toggleIcon">&#9660;</span>
            </div>
            <div class="collapsible-content" id="userInstructionsContent">
                <textarea id="userInstructions" rows="2" placeholder="Instructions for commit generation."></textarea>
            </div>
            <!-- Collapsible Commit Message -->
            <div class="collapsible-header" id="commitMessageHeader">
                <h3>Commit Message</h3>
                <span class="toggle-icon" id="commitToggleIcon">&#9660;</span>
            </div>
            <div class="collapsible-content" id="commitMessageContent">
                <textarea id="commitMessage" rows="4" placeholder="Generated commit message will appear here..."></textarea>
            </div>
            <div class="file-list" id="fileList"></div>
        </div>
        <div class="footer">
            <button id="generateBtn" style="width: 100%;">Generate Commit Message</button>
            <!-- Generating Animation -->
            <div id="generatingAnimation">
                <div class="loader"></div>
            </div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            let selectedFiles = new Set();
            // Toggle User Instructions Visibility
            const userInstructionsHeader = document.getElementById('userInstructionsHeader');
            const userInstructionsContent = document.getElementById('userInstructionsContent');
            const toggleIcon = document.getElementById('toggleIcon');
            userInstructionsHeader.addEventListener('click', () => {
                const isActive = userInstructionsContent.classList.toggle('active');
                toggleIcon.classList.toggle('collapsed', !isActive);
            });
            // Toggle Commit Message Visibility
            const commitMessageHeader = document.getElementById('commitMessageHeader');
            const commitMessageContent = document.getElementById('commitMessageContent');
            const commitToggleIcon = document.getElementById('commitToggleIcon');
            commitMessageHeader.addEventListener('click', () => {
                const isActive = commitMessageContent.classList.toggle('active');
                commitToggleIcon.classList.toggle('collapsed', !isActive);
            });
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
                // Show Generating Animation
                const generatingAnimation = document.getElementById('generatingAnimation');
                generatingAnimation.style.display = 'block';

                // Ensure Commit Message section is visible
                if (!commitMessageContent.classList.contains('active')) {
                    commitMessageContent.classList.add('active');
                    commitToggleIcon.classList.remove('collapsed');
                }

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
                        // Hide Generating Animation
                        document.getElementById('generatingAnimation').style.display = 'none';
                        document.getElementById('commitMessage').value = message.message;
                        break;
                    case 'error':
                        // Hide Generating Animation on error
                        document.getElementById('generatingAnimation').style.display = 'none';
                        console.error(message.message);
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
                    <label for="selectAll">Select All</label>
                    <span></span> <!-- Empty span to align with status -->
                    <input type="checkbox" id="selectAll">
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
                    const statusClass = file.staged ? 'status-staged' : file.modified ? 'status-modified' : 'status-untracked';
                    div.innerHTML = \`
                        <label>\${file.path}</label>
                        <span class="file-status \${statusClass}">\${file.staged ? 'Staged' : file.modified ? 'Modified' : 'Untracked'}</span>
                        <input type="checkbox" data-path="\${file.path}">
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
