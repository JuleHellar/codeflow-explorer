import * as vscode from "vscode";
import * as path from "path";
import { Analysis } from "./types";

interface AnalysisPanelState {
  analysis: Analysis;
  workspacePath: string;
  getActiveFile: () => string | undefined;
}

const panelStates = new WeakMap<vscode.WebviewPanel, AnalysisPanelState>();

function initialFilePath(
  workspacePath: string,
  analysis: Analysis,
  activeFile: string | undefined
): string {
  const activeRelative = activeFile
    ? path.relative(workspacePath, activeFile).replace(/\\/g, "/")
    : "";
  return analysis.files.some(
    file => file.path.toLowerCase() === activeRelative.toLowerCase()
  ) ? activeRelative : "";
}

export function showAnalysis(
  context: vscode.ExtensionContext,
  workspacePath: string,
  analysis: Analysis,
  initialActiveFile: string | undefined,
  getActiveFile: () => string | undefined
): vscode.WebviewPanel {
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
  const state = { analysis, workspacePath, getActiveFile };
  panelStates.set(panel, state);

  const script = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "bundle.js")
  );
  const style = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "main.css")
  );
  const nonce = Math.random().toString(36).slice(2);
  const data = JSON.stringify(state.analysis).replace(/</g, "\\u003c");
  const initialRelative = initialFilePath(workspacePath, analysis, initialActiveFile);

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
  <div class="toolbar-row toolbar-actions">
    <button id="reanalyze" type="button" title="Run the workspace analysis again">Re-analyse</button>
    <button id="saveAnalysis" type="button">Save notes</button>
  </div>
  <div class="toolbar-row toolbar-file">
    <button id="viewBack" type="button" aria-label="Previous file view" title="Previous file view" disabled>←</button>
    <button id="viewForward" type="button" aria-label="Next file view" title="Next file view" disabled>→</button>
    <label for="filePicker">File</label>
    <select id="filePicker" aria-label="Select source file"></select>
    <button id="resetFile" title="Reset view to the source file currently active in VS Code">To active</button>
    <span id="summary"></span>
  </div>
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
      const active = state.getActiveFile();
      if (!active) {
        void vscode.window.showInformationMessage(
          "No previously active source file was recorded. Open a Python or Fortran file, then try again."
        );
        return;
      }
      const relative = path.relative(state.workspacePath, active).replace(/\\/g, "/");
      await panel.webview.postMessage({ command: "select-file", path: relative });
      return;
    }

    if (message.command === "open" && typeof message.file === "string") {
      const absolute = path.resolve(state.workspacePath, message.file);
      if (!absolute.startsWith(path.resolve(state.workspacePath) + path.sep) &&
          absolute !== path.resolve(state.workspacePath)) return;

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
      return;
    }

    if (message.command === "reanalyze") {
      try {
        const opened = await vscode.commands.executeCommand<boolean>(
          "codeflowExplorer.analyze"
        );
        await panel.webview.postMessage({
          command: "reanalyze-result",
          success: opened
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`CodeFlow Explorer could not re-analyze: ${detail}`);
        await panel.webview.postMessage({ command: "reanalyze-result", success: false });
      }
      return;
    }

    if (message.command === "save-notes") {
      if (!message.functions || typeof message.functions !== "object" ||
          Array.isArray(message.functions) || !message.classes ||
          typeof message.classes !== "object" || Array.isArray(message.classes) ||
          !Number.isInteger(message.revision)) {
        void vscode.window.showErrorMessage("CodeFlow Explorer received invalid notes to save.");
        await panel.webview.postMessage({
          command: "save-result",
          success: false,
          revision: message.revision
        });
        return;
      }

      const functionsById = new Map<
        string,
        Analysis["files"][number]["functions"][number][]
      >();
      const classById = new Map<string, Analysis["files"][number]["classes"][number]>();
      const addFunction = (fn: Analysis["files"][number]["functions"][number]) => {
        const functions = functionsById.get(fn.id) ?? [];
        functions.push(fn);
        functionsById.set(fn.id, functions);
      };
      for (const file of state.analysis.files) {
        for (const fn of file.functions) addFunction(fn);
        for (const cls of file.classes) {
          classById.set(cls.id, cls);
          for (const fn of cls.methods) addFunction(fn);
        }
      }

      const functionNotes = Object.entries(message.functions as Record<string, unknown>);
      const classNotes = Object.entries(message.classes as Record<string, unknown>);
      if (functionNotes.some(([, note]) => typeof note !== "string") ||
          classNotes.some(([, note]) => typeof note !== "string")) {
        void vscode.window.showErrorMessage("CodeFlow Explorer received invalid notes to save.");
        await panel.webview.postMessage({
          command: "save-result",
          success: false,
          revision: message.revision
        });
        return;
      }

      for (const [id, note] of functionNotes) {
        if (typeof note === "string") {
          for (const fn of functionsById.get(id) ?? []) fn.note = note;
        }
      }
      for (const [id, note] of classNotes) {
        const cls = classById.get(id);
        if (cls && typeof note === "string") cls.note = note;
      }

      try {
        const analysisDirectory = vscode.Uri.joinPath(
          vscode.Uri.file(state.workspacePath),
          ".codeflow-explorer"
        );
        const analysisFile = vscode.Uri.joinPath(analysisDirectory, "analysis.json");
        await vscode.workspace.fs.createDirectory(analysisDirectory);
        await vscode.workspace.fs.writeFile(
          analysisFile,
          Buffer.from(`${JSON.stringify(state.analysis, null, 2)}\n`, "utf8")
        );
        await panel.webview.postMessage({
          command: "save-result",
          success: true,
          revision: message.revision
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`CodeFlow Explorer could not save notes: ${detail}`);
        await panel.webview.postMessage({
          command: "save-result",
          success: false,
          revision: message.revision
        });
      }
    }
  });
  return panel;
}

export async function updateAnalysis(
  panel: vscode.WebviewPanel,
  workspacePath: string,
  analysis: Analysis,
  activeFile: string | undefined,
  getActiveFile: () => string | undefined
): Promise<boolean> {
  const state = panelStates.get(panel);
  if (!state) return false;

  state.analysis = analysis;
  state.workspacePath = workspacePath;
  state.getActiveFile = getActiveFile;
  return panel.webview.postMessage({
    command: "update-analysis",
    analysis,
    initialFile: initialFilePath(workspacePath, analysis, activeFile)
  });
}
