import * as vscode from "vscode";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { Analysis } from "./types";
import { showAnalysis } from "./panel";

const execFileAsync = promisify(execFile);
const FORTRAN_EXTENSIONS = new Set([
  ".f", ".for", ".ftn", ".f77", ".f90", ".f95", ".f03", ".f08", ".f18"
]);

export function activate(context: vscode.ExtensionContext): void {
  let lastActiveSourceFile: string | undefined;

  const rememberEditor = (editor: vscode.TextEditor | undefined) => {
    const file = editor?.document.uri.fsPath;
    const extension = file && path.extname(file).toLowerCase();
    if (file && (extension === ".py" || FORTRAN_EXTENSIONS.has(extension))) {
      lastActiveSourceFile = file;
    }
  };

  rememberEditor(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(rememberEditor)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codeflowExplorer.analyze", async () => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) {
        void vscode.window.showWarningMessage("Open a Python or Fortran project folder first.");
        return;
      }

      rememberEditor(vscode.window.activeTextEditor);

      try {
        const python = vscode.workspace
          .getConfiguration("codeflowExplorer")
          .get<string>("pythonPath", "python");
        const analyzer = context.asAbsolutePath(path.join("python", "analyzer.py"));

        const { stdout, stderr } = await execFileAsync(
          python,
          [analyzer, workspace.uri.fsPath],
          { maxBuffer: 50 * 1024 * 1024 }
        );

        if (stderr.trim()) console.warn(stderr);

        const analysis = JSON.parse(stdout) as Analysis;
        showAnalysis(context, workspace.uri.fsPath, analysis, lastActiveSourceFile,
          () => lastActiveSourceFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`CodeFlow analysis failed: ${message}`);
      }
    })
  );
}

export function deactivate(): void {}
