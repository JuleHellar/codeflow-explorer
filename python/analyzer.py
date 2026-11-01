#!/usr/bin/env python3
"""Dependency-free Python and Fortran project analyser for CodeFlow Explorer."""
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path


EXCLUDED = {".git", ".venv", "venv", "__pycache__", "node_modules", ".mypy_cache", ".pytest_cache"}
FORTRAN_EXTENSIONS = {".f", ".for", ".ftn", ".f77", ".f90", ".f95", ".f03", ".f08", ".f18"}
FIXED_FORM_EXTENSIONS = {".f", ".for", ".ftn", ".f77"}


def module_name(relative: Path) -> str:
    parts = list(relative.with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts) or relative.stem


def dotted(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        left = dotted(node.value)
        return f"{left}.{node.attr}" if left else node.attr
    return ""


def source_text(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        return type(node).__name__


class FunctionBodyVisitor(ast.NodeVisitor):
    def __init__(self):
        self.calls = []
        self.returns = []

    def visit_FunctionDef(self, node):
        return

    def visit_AsyncFunctionDef(self, node):
        return

    def visit_ClassDef(self, node):
        return

    def visit_Call(self, node):
        self.calls.append((dotted(node.func), node.lineno))
        self.generic_visit(node)

    def visit_Return(self, node):
        if node.value is not None:
            value = source_text(node.value)
            if value not in self.returns:
                self.returns.append(value)
        self.generic_visit(node)


class ModuleBuilder(ast.NodeVisitor):
    def __init__(self, path: str, module: str):
        self.path = path
        self.module = module
        self.classes = []
        self.functions = []
        self.items = []
        self.imports = {}
        self.class_stack = []
        self.function_stack = []

    def visit_Import(self, node):
        for alias in node.names:
            self.imports[alias.asname or alias.name.split(".")[0]] = alias.name

    def visit_ImportFrom(self, node):
        base = node.module or ""
        for alias in node.names:
            if alias.name != "*":
                self.imports[alias.asname or alias.name] = f"{base}.{alias.name}".strip(".")

    def visit_ClassDef(self, node):
        qualified = ".".join([self.module] + [c["name"] for c in self.class_stack] + [node.name])
        cls = {
            "id": f"class:{self.module}:{node.lineno}:{qualified}",
            "name": node.name,
            "qualifiedName": qualified,
            "file": self.path,
            "line": node.lineno,
            "order": node.lineno,
            "methods": []
        }
        self.classes.append(cls)
        if not self.class_stack and not self.function_stack:
            self.items.append({"kind": "class", "id": cls["id"], "line": node.lineno, "order": node.lineno})
        self.class_stack.append(cls)
        for child in node.body:
            self.visit(child)
        self.class_stack.pop()

    def _function(self, node):
        parents = [c["name"] for c in self.class_stack]
        qualified = ".".join([self.module] + parents + [node.name])
        fn = {
            "id": f"function:{self.module}:{node.lineno}:{qualified}",
            "name": node.name,
            "qualifiedName": qualified,
            "file": self.path,
            "line": node.lineno,
            "endLine": getattr(node, "end_lineno", node.lineno),
            "order": node.lineno,
            "params": [],
            "returns": [],
            "calls": [],
            "externalCalls": [],
            "parentClass": self.class_stack[-1]["id"] if self.class_stack else None
        }

        args = node.args
        all_args = list(args.posonlyargs) + list(args.args)
        if args.vararg:
            all_args.append(args.vararg)
        all_args.extend(args.kwonlyargs)
        if args.kwarg:
            all_args.append(args.kwarg)
        fn["params"] = [{"name": arg.arg} for arg in all_args]

        visitor = FunctionBodyVisitor()
        for statement in node.body:
            visitor.visit(statement)
        fn["returns"] = visitor.returns
        fn["_rawCalls"] = visitor.calls

        self.functions.append(fn)
        if self.class_stack:
            self.class_stack[-1]["methods"].append(fn)
        elif not self.function_stack:
            self.items.append({"kind": "function", "id": fn["id"], "line": node.lineno, "order": node.lineno})

        self.function_stack.append(fn)
        # Nested functions are discovered as functions too, but have their own body.
        for statement in node.body:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self._function(statement)
        self.function_stack.pop()

    def visit_FunctionDef(self, node):
        self._function(node)

    def visit_AsyncFunctionDef(self, node):
        self._function(node)


def strip_fortran_comment(line: str) -> str:
    quote = None
    index = 0
    while index < len(line):
        char = line[index]
        if quote:
            if char == quote:
                if index + 1 < len(line) and line[index + 1] == quote:
                    index += 1
                else:
                    quote = None
        elif char in {"'", '"'}:
            quote = char
        elif char == "!":
            return line[:index]
        index += 1
    return line


def split_fortran_statements(line: str):
    statements = []
    quote = None
    start = 0
    index = 0
    while index < len(line):
        char = line[index]
        if quote:
            if char == quote:
                if index + 1 < len(line) and line[index + 1] == quote:
                    index += 1
                else:
                    quote = None
        elif char in {"'", '"'}:
            quote = char
        elif char == ";":
            statement = line[start:index].strip()
            if statement:
                statements.append(statement)
            start = index + 1
        index += 1
    statement = line[start:].strip()
    if statement:
        statements.append(statement)
    return statements


def fortran_statements(source: str, fixed_form: bool):
    logical_lines = []
    current = ""
    current_line = 0

    def flush():
        nonlocal current, current_line
        if current:
            logical_lines.extend(
                (current_line, statement)
                for statement in split_fortran_statements(current)
            )
        current = ""
        current_line = 0

    for line_number, physical_line in enumerate(source.splitlines(), 1):
        if fixed_form:
            if not physical_line or physical_line[0] in "cC*!":
                continue
            continuation = len(physical_line) > 5 and physical_line[5] not in " 0"
            code = physical_line[6:72] if len(physical_line) > 6 else ""
            code = strip_fortran_comment(code).strip()
            if not code:
                continue
            if continuation and current:
                current += " " + code
            else:
                flush()
                current = code
                current_line = line_number
        else:
            code = strip_fortran_comment(physical_line).strip()
            if not code:
                continue
            if current and code.startswith("&"):
                code = code[1:].lstrip()
            if not current:
                current_line = line_number
            continued = code.endswith("&")
            current += (" " if current else "") + (code[:-1].rstrip() if continued else code)
            if not continued:
                flush()

    flush()
    return logical_lines


def fortran_arguments(statement: str, name_end: int):
    remainder = statement[name_end:].lstrip()
    if not remainder.startswith("("):
        return []
    depth = 0
    quote = None
    for index, char in enumerate(remainder):
        if quote:
            if char == quote:
                quote = None
        elif char in {"'", '"'}:
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return [
                    {"name": argument.strip()}
                    for argument in remainder[1:index].split(",")
                    if argument.strip()
                ]
    return []


def analyse_fortran_file(relative: str, source: str):
    extension = Path(relative).suffix.lower()
    module = module_name(Path(relative))
    statements = fortran_statements(source, extension in FIXED_FORM_EXTENSIONS)
    classes = []
    functions = []
    items = []
    imports = {}
    used_modules = []
    current_module = None
    current_module_class = None
    current_type = None
    current_function = None

    routine_pattern = re.compile(
        r"^\s*(?:(?:recursive|pure|elemental|impure|module|non_recursive)\s+|"
        r"(?:(?:integer|real|complex|logical|character|double\s+precision|"
        r"type\s*\([^)]*\)|class\s*\([^)]*\))"
        r"(?:\s*\([^)]*\))?\s+))*(subroutine|function|program)\s+([a-z]\w*)",
        re.IGNORECASE,
    )

    for line, statement in statements:
        lowered = statement.lower()
        module_match = re.match(r"^\s*module\s+(?!procedure\b)([a-z]\w*)", statement, re.I)
        if module_match:
            current_module = module_match.group(1)
            qualified = current_module
            current_module_class = {
                "id": f"class:{module}:{line}:{qualified}",
                "name": current_module,
                "qualifiedName": qualified,
                "file": relative,
                "line": line,
                "order": line,
                "methods": [],
            }
            classes.append(current_module_class)
            items.append({
                "kind": "class", "id": current_module_class["id"],
                "line": line, "order": line
            })
            continue

        if re.match(r"^\s*end\s*module\b", statement, re.I):
            current_module = None
            current_module_class = None
            continue

        use_match = re.match(
            r"^\s*use\s*(?:,\s*(?:non_)?intrinsic\s*)?(?:::\s*)?([a-z]\w*)"
            r"(?:\s*,\s*only\s*:\s*(.*))?",
            statement, re.I
        )
        if use_match:
            used_module = use_match.group(1).lower()
            if used_module not in used_modules:
                used_modules.append(used_module)
            only_list = use_match.group(2)
            if only_list:
                for entry in only_list.split(","):
                    alias_parts = re.split(r"\s*=>\s*", entry.strip(), maxsplit=1)
                    if len(alias_parts) == 2:
                        local_name, remote_name = alias_parts[0].strip(), alias_parts[1].strip()
                    else:
                        local_name = remote_name = alias_parts[0].strip()
                    if local_name and remote_name:
                        imports[local_name.lower()] = f"{used_module}.{remote_name.lower()}"
            continue

        type_match = re.match(
            r"^\s*type\b(?:(?:\s*,[^:]*)?\s*::\s*|\s+)([a-z]\w*)\s*$",
            statement, re.I
        )
        if type_match and not re.match(r"^\s*type\s*\(", statement, re.I):
            type_name = type_match.group(1)
            type_qualified = ".".join(part for part in (current_module, type_name) if part)
            current_type = {
                "id": f"class:{module}:{line}:{type_qualified}",
                "name": type_name,
                "qualifiedName": type_qualified,
                "file": relative,
                "line": line,
                "order": line,
                "methods": [],
            }
            classes.append(current_type)
            items.append({
                "kind": "class", "id": current_type["id"],
                "line": line, "order": line
            })
            continue

        if re.match(r"^\s*end\s*type\b", statement, re.I):
            current_type = None
            continue

        if current_function:
            if re.match(r"^\s*contains\b", statement, re.I):
                current_function["_body"].append((line, "contains"))
                continue
            if re.match(r"^\s*end(?:\s*(?:subroutine|function|program)\b.*)?\s*$", statement, re.I):
                current_function["endLine"] = line
                current_function = None
                continue
            current_function["_body"].append((line, statement))
            continue

        routine_match = routine_pattern.match(statement)
        if routine_match:
            kind, name = routine_match.group(1).lower(), routine_match.group(2)
            name_end = routine_match.end()
            params = fortran_arguments(statement, name_end)
            result_match = re.search(r"\bresult\s*\(\s*([a-z]\w*)\s*\)", statement, re.I)
            scope = current_module or module
            qualified = f"{scope}.{name}"
            fn = {
                "id": f"function:{module}:{line}:{qualified}",
                "name": name,
                "qualifiedName": qualified,
                "file": relative,
                "line": line,
                "endLine": line,
                "order": line,
                "params": params,
                "returns": [result_match.group(1)] if kind == "function" and result_match else (
                    [name] if kind == "function" else []
                ),
                "calls": [],
                "externalCalls": [],
                "parentClass": current_module_class["id"] if current_module_class else None,
                "_fortranKind": kind,
                "_body": [],
                "_rawCalls": [],
            }
            functions.append(fn)
            if current_module_class:
                current_module_class["methods"].append(fn)
            elif not current_type:
                items.append({
                    "kind": "function", "id": fn["id"],
                    "line": line, "order": line
                })
            elif current_type:
                current_type["methods"].append(fn)
                fn["parentClass"] = current_type["id"]
            current_function = fn
            continue

        if re.match(r"^\s*end\b", lowered):
            continue

    for fn in functions:
        raw_calls = []
        for line, statement in fn.pop("_body"):
            matches = list(re.finditer(
                r"\b([a-z]\w*(?:%[a-z]\w*)*)\s*\(", statement, re.I
            ))
            for match in matches:
                raw_calls.append((match.group(1), line))
            explicit_calls = re.finditer(
                r"\bcall\s+([a-z]\w*(?:%[a-z]\w*)*)",
                statement, re.I
            )
            for match in explicit_calls:
                name = match.group(1)
                if not any(
                    call_name.lower() == name.lower() and call_line == line
                    for call_name, call_line in raw_calls
                ):
                    raw_calls.append((name, line))
        fn["_rawCalls"] = raw_calls
        fn.pop("_fortranKind", None)

    items.sort(key=lambda item: item["order"])
    functions.sort(key=lambda fn: fn["order"])
    for cls in classes:
        cls["methods"].sort(key=lambda fn: fn["order"])

    return {
        "path": relative,
        "module": module,
        "items": items,
        "classes": classes,
        "functions": functions,
        "_imports": imports,
        "_usedModules": used_modules,
        "_fortran": True,
    }


def analyse(root: Path):
    root = root.resolve()
    files = []
    all_functions = []
    warnings = []

    source_files = (
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in ({".py"} | FORTRAN_EXTENSIONS)
    )
    for path in sorted(source_files):
        if any(part in EXCLUDED for part in path.parts):
            continue
        relative = path.relative_to(root).as_posix()
        module = module_name(Path(relative))
        try:
            source = path.read_text(encoding="utf-8")
            if path.suffix.lower() in FORTRAN_EXTENSIONS:
                file_info = analyse_fortran_file(relative, source)
                files.append(file_info)
                all_functions.extend(file_info["functions"])
                continue
            tree = ast.parse(source, filename=relative)
        except (SyntaxError, UnicodeError, OSError) as exc:
            warnings.append(f"{relative}: {exc}")
            continue

        builder = ModuleBuilder(relative, module)
        for statement in tree.body:
            builder.visit(statement)

        # Sort source-order collections; classes contain their methods in source order.
        builder.items.sort(key=lambda item: item["order"])
        builder.functions.sort(key=lambda fn: fn["order"])
        for cls in builder.classes:
            cls["methods"].sort(key=lambda fn: fn["order"])

        for fn in builder.functions:
            all_functions.append(fn)

        files.append({
            "path": relative,
            "module": module,
            "items": builder.items,
            "classes": builder.classes,
            "functions": builder.functions,
            "_imports": builder.imports
        })
    qualified_index = {}
    casefolded_qualified_index = {}
    short_index = {}
    casefolded_same_file_index = {}
    for fn in all_functions:
        scope = fn["qualifiedName"].split(".")[0]
        short_index.setdefault((scope, fn["name"]), []).append(fn)
        qualified_index[fn["qualifiedName"]] = fn
        casefolded_qualified_index[fn["qualifiedName"].lower()] = fn
        casefolded_same_file_index.setdefault(
            (fn["file"], fn["name"].lower()), []
        ).append(fn)

    edges = []
    for file in files:
        imports = file["_imports"]
        module = file["module"]
        is_fortran = file.get("_fortran", False)
        used_modules = file.get("_usedModules", [])
        for fn in file["functions"]:
            for call_name, line in fn.pop("_rawCalls", []):
                if not call_name:
                    continue
                candidates = []
                normalized_name = call_name.replace("%", ".") if is_fortran else call_name
                short_name = normalized_name.split(".")[-1]

                if is_fortran:
                    imported = imports.get(call_name.split("%")[0].lower())
                    if imported:
                        suffix = normalized_name.split(".")[1:]
                        qualified = imported + (("." + ".".join(suffix)) if suffix else "")
                        target = casefolded_qualified_index.get(qualified.lower())
                        if target:
                            candidates = [target]
                    if not candidates and "." in normalized_name:
                        target = casefolded_qualified_index.get(normalized_name.lower())
                        if target:
                            candidates = [target]
                    if not candidates:
                        candidates = casefolded_same_file_index.get(
                            (file["path"], short_name.lower()), []
                        )
                    if not candidates:
                        caller_scope = fn["qualifiedName"].split(".")[0].lower()
                        target = casefolded_qualified_index.get(
                            f"{caller_scope}.{short_name}".lower()
                        )
                        if target:
                            candidates = [target]
                    if not candidates:
                        for used_module in used_modules:
                            target = casefolded_qualified_index.get(
                                f"{used_module}.{short_name}".lower()
                            )
                            if target:
                                candidates.append(target)
                else:
                    first, *rest = call_name.split(".")
                    imported = imports.get(first)
                    if imported:
                        qualified = imported + (("." + ".".join(rest)) if rest else "")
                        target = qualified_index.get(qualified)
                        if target:
                            candidates = [target]
                    if not candidates:
                        candidates = short_index.get((module, short_name), [])
                    if not candidates and call_name.startswith("self.") and fn.get("parentClass"):
                        owner = next((c for c in file["classes"] if c["id"] == fn["parentClass"]), None)
                        if owner:
                            candidates = [m for m in owner["methods"] if m["name"] == short_name]

                if len(candidates) == 1:
                    target = candidates[0]
                    if target["id"] not in fn["calls"]:
                        fn["calls"].append(target["id"])
                    edges.append({"source": fn["id"], "target": target["id"], "line": line})
                else:
                    label = call_name
                    if label not in fn["externalCalls"]:
                        fn["externalCalls"].append(label)

        # Remove internal-only helper keys before serialising.
        file.pop("_imports", None)
        file.pop("_usedModules", None)
        file.pop("_fortran", None)

    return {
        "files": files,
        "edges": edges,
        "filesScanned": len(files),
        "warnings": warnings
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: analyzer.py <workspace-folder>")
    print(json.dumps(analyse(Path(sys.argv[1]))))
