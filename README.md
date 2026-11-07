# CodeFlow Explorer 0.2 — file-based organigram

This revision changes the diagram renderer to custom HTML/CSS + SVG. The analyser supports Python and Fortran source files. Mermaid is retained as a package dependency in this starter only for possible future graph modes, but the organigram itself does not use Mermaid: Mermaid flowcharts are not a good fit for variable panels inside nested file/class/function boxes.

## Install and run

1. Open this folder in VS Code.
2. Open Terminal → New Terminal in this folder (the one containing `package.json`).
3. Run:

   ```powershell
   npm install
   npm run compile
   ```

4. Press F5 to launch the Extension Development Host.
5. Open a Python or Fortran workspace in that new window.
6. Run `Ctrl+Shift+P` → `CodeFlow: Analyse Python and Fortran Workspace`.

`python/analyzer.py` uses only Python's standard library. No pip install and no Python virtual environment are required. If your Python command is `python3`, set `codeflowExplorer.pythonPath` to `python3` in VS Code settings.
Fortran files with `.f`, `.for`, `.ftn`, `.f77`, `.f90`, `.f95`, `.f03`, `.f08`, and `.f18` extensions are included. Modules appear as class-like containers, and subroutines, functions, and program units use the existing function cards. Both common fixed-form extensions and free-form source are recognized.

Each analysis is also saved as formatted JSON to `.codeflow-explorer/analysis.json` in the workspace. The JSON contains the files, functions, and resolved call edges used by the diagram; the generated directory is ignored by Git.
Notes can be edited in the function and class boxes for the selected file and saved to the same JSON file with the **Save notes** button or Ctrl+S (Cmd+S on macOS). Notes are retained when the workspace is analyzed again; class and function IDs are based on their file/module and qualified name, not source line numbers.

## Fortran test fixture

`test/fixture_fortran` is a small multi-file checkout example with modules, derived types, functions, subroutines, and cross-module calls. To inspect it in the diagram, open that folder as the workspace in VS Code and run the analysis command. To verify the analyzer and its regression tests from the project root, run:

```powershell
python -m unittest discover -s test -p 'test_*.py'
```

## Organigram controls

- The dropdown selects a Python or Fortran source file from the analysed workspace.
- The **Back** and **Forward** buttons navigate a history of up to five file views; view history does not undo edits or other actions.
- **Re-analyse** reruns the workspace analysis; it saves the current notes first and updates the existing diagram without resetting its window size or zoom.
- Drag the diagram with the mouse to pan around it.
- Hold Alt and drag a box to move it; moving a file or class box also moves its contents. Call arrows follow the moved boxes.
- “Reset view to active file” switches to the last active Python or Fortran editor known to the extension.
- File contents are ordered by source line: classes and top-level functions, then methods in their class.
- Each function card shows its inputs and detected return values in vertically scrollable panels.
- Blue arrows represent resolved calls between functions in the selected file.
- Resolved calls into the selected file from other files appear as arrows from caller boxes on the left, separated from the file by a dashed boundary. Click a caller box to view its file in the diagram; Ctrl+click opens it in VS Code.
- Resolved calls from the selected file to functions in other files appear as arrows to callee boxes on the right, beyond a dashed boundary. Callee boxes are ordered by caller and call-site order. Click a callee box to view its file in the diagram; Ctrl+click opens it in VS Code.
- Calls with unresolved targets cannot be drawn; the analyzer only creates arrows for calls it can resolve.

## Important analysis limitations

This is static analysis. Python calls are resolved for straightforward same-file functions, simple imported names, and `self.method()` within a class. Fortran calls are resolved for same-file procedures, module procedures, and procedures brought in with `use` statements (including `only` aliases). Dynamic dispatch, arbitrary object method resolution, inheritance, reflection, monkey-patching, complex relative imports, ambiguous overloads, and runtime-generated code are not resolved reliably. Fortran source is parsed without a compiler; function return panels show the declared result variable or function name.

## Build a VSIX

```bash
npm run compile
npx vsce package
```

Install the resulting `.vsix` via VS Code → Extensions → `...` → Install from VSIX.
