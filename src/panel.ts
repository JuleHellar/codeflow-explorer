import * as vscode from "vscode";
import * as path from "path";
import { Analysis } from "./types";

export function showAnalysis(
  context: vscode.ExtensionContext,
  workspacePath: string,
  analysis: Analysis,
  initialActiveFile: string | undefined,
  getActiveFile: () => string | undefined
): void {
  const panel = vscode.window.createWebviewPanel(
    "codeflowExplorer",
    "CodeFlow Explorer",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
    }
  );

  const script = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "bundle.js")
  );
  const style = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "main.css")
  );
  const nonce = Math.random().toString(36).slice(2);
  const data = JSON.stringify(analysis).replace(/</g, "\\u003c");
  const activeRelative = initialActiveFile
    ? path.relative(workspacePath, initialActiveFile).replace(/\\/g, "/")
    : "";
  const initialRelative = analysis.files.some(
    file => file.path.toLowerCase() === activeRelative.toLowerCase()
  ) ? activeRelative : "";

  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
 content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${style}">
</head>
<body>
<header class="toolbar">
  <strong>CodeFlow Explorer</strong>
  <label for="filePicker">File</label>
  <select id="filePicker" aria-label="Select source file"></select>
  <button id="resetFile" title="Select the source file currently active in VS Code">Reset to active VS Code file</button>
  <span id="summary"></span>
</header>
<div id="canvas">
  <div id="diagram">
    <svg id="links" aria-hidden="true"></svg>
    <div id="fileView"></div>
  </div>
</div>
<footer class="canvas-controls" aria-label="Diagram zoom controls">
  <button id="zoomOut" type="button" title="Zoom out (-)" aria-label="Zoom out">−</button>
  <button id="zoomIn" type="button" title="Zoom in (+)" aria-label="Zoom in">+</button>
  <button id="fitDiagram" type="button" title="Fit diagram in window">Fit</button>
</footer>
<script nonce="${nonce}">window.CODEFLOW = ${data}; window.INITIAL_FILE = ${JSON.stringify(initialRelative)};</script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "reset-active-file") {
      const active = getActiveFile();
      if (!active) {
        void vscode.window.showInformationMessage(
          "No previously active source file was recorded. Open a Python or Fortran file, then try again."
        );
        return;
      }
      const relative = path.relative(workspacePath, active).replace(/\\/g, "/");
      await panel.webview.postMessage({ command: "select-file", path: relative });
      return;
    }

    if (message.command === "open" && typeof message.file === "string") {
      const absolute = path.resolve(workspacePath, message.file);
      if (!absolute.startsWith(path.resolve(workspacePath) + path.sep) &&
          absolute !== path.resolve(workspacePath)) return;

      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
      const otherGroup = vscode.window.tabGroups.all.find(
        group => group.viewColumn !== panel.viewColumn
      );
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: otherGroup?.viewColumn ?? vscode.ViewColumn.Beside
      });
      const position = new vscode.Position(Math.max(0, Number(message.line) - 1), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter);
    }
  });
}
