import * as vscode from "vscode";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { Analysis } from "./types";
import { showAnalysis, updateAnalysis } from "./panel";

const execFileAsync = promisify(execFile);
const FORTRAN_EXTENSIONS = new Set([
  ".f", ".for", ".ftn", ".f77", ".f90", ".f95", ".f03", ".f08", ".f18"
]);

export function activate(context: vscode.ExtensionContext): void {
  let lastActiveSourceFile: string | undefined;
  let analysisPanel: vscode.WebviewPanel | undefined;

  const rememberEditor = (editor: vscode.TextEditor | undefined) => {
    const file = editor?.document.uri.fsPath;
    const extension = file && path.extname(file).toLowerCase();
    if (file && extension &&
        (extension === ".py" || FORTRAN_EXTENSIONS.has(extension))) {
      lastActiveSourceFile = file;
    }
  };

  rememberEditor(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(rememberEditor)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codeflowExplorer.analyze", async (): Promise<boolean> => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) {
        void vscode.window.showWarningMessage("Open a Python or Fortran project folder first.");
        return false;
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
        const analysisDirectory = vscode.Uri.joinPath(workspace.uri, ".codeflow-explorer");
        const analysisFile = vscode.Uri.joinPath(analysisDirectory, "analysis.json");
        try {
          const previousAnalysis = await vscode.workspace.fs.readFile(analysisFile);
          const previous = JSON.parse(Buffer.from(previousAnalysis).toString("utf8")) as Analysis;
          restoreNotes(analysis, previous);
        } catch (error) {
          if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") {
            throw error;
          }
        }

        try {
          await vscode.workspace.fs.createDirectory(analysisDirectory);
          await vscode.workspace.fs.writeFile(
            analysisFile,
            Buffer.from(`${JSON.stringify(analysis, null, 2)}\n`, "utf8")
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(
            `CodeFlow analysis could not be saved to ${analysisFile.fsPath}: ${message}`
          );
        }

        const getActiveFile = () => lastActiveSourceFile;
        const updated = analysisPanel
          ? await updateAnalysis(
            analysisPanel,
            workspace.uri.fsPath,
            analysis,
            lastActiveSourceFile,
            getActiveFile
          )
          : false;
        if (!updated) {
          analysisPanel = showAnalysis(
            context,
            workspace.uri.fsPath,
            analysis,
            lastActiveSourceFile,
            getActiveFile
          );
          const createdPanel = analysisPanel;
          context.subscriptions.push(createdPanel.onDidDispose(() => {
            if (analysisPanel === createdPanel) analysisPanel = undefined;
          }));
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`CodeFlow analysis failed: ${message}`);
        return false;
      }
    })
  );
}

function restoreNotes(analysis: Analysis, previous: Analysis): void {
  const functionNotes = new Map<string, string>();
  const classNotes = new Map<string, string>();
  const noteKey = (file: string, qualifiedName: string) =>
    JSON.stringify([file, qualifiedName]);
  const collectFunctionNotes = (
    filePath: string,
    fn: Analysis["files"][number]["functions"][number]
  ) => {
    if (typeof fn.note === "string") {
      functionNotes.set(noteKey(filePath, fn.qualifiedName), fn.note);
    }
    fn.nestedFunctions?.forEach(nested => collectFunctionNotes(filePath, nested));
  };
  const restoreFunctionNote = (
    filePath: string,
    fn: Analysis["files"][number]["functions"][number]
  ) => {
    const note = functionNotes.get(noteKey(filePath, fn.qualifiedName));
    if (note !== undefined) fn.note = note;
    fn.nestedFunctions?.forEach(nested => restoreFunctionNote(filePath, nested));
  };

  for (const file of previous.files) {
    file.functions.forEach(fn => collectFunctionNotes(file.path, fn));
    for (const cls of file.classes) {
      if (typeof cls.note === "string") {
        classNotes.set(noteKey(file.path, cls.qualifiedName), cls.note);
      }
      cls.methods.forEach(fn => collectFunctionNotes(file.path, fn));
    }
  }

  for (const file of analysis.files) {
    file.functions.forEach(fn => restoreFunctionNote(file.path, fn));
    for (const cls of file.classes) {
      const classNote = classNotes.get(noteKey(file.path, cls.qualifiedName));
      if (classNote !== undefined) cls.note = classNote;
      cls.methods.forEach(fn => restoreFunctionNote(file.path, fn));
    }
  }
}

export function deactivate(): void {}
