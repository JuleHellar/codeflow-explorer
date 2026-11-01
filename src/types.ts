export interface VariableInfo {
  name: string;
  expression?: string;
}

export interface FunctionInfo {
  id: string;
  name: string;
  qualifiedName: string;
  file: string;
  line: number;
  endLine: number;
  order: number;
  params: VariableInfo[];
  returns: string[];
  calls: string[];
  externalCalls: string[];
  parentClass?: string;
}

export interface ClassInfo {
  id: string;
  name: string;
  qualifiedName: string;
  file: string;
  line: number;
  order: number;
  methods: FunctionInfo[];
}

export interface FileItem {
  kind: "class" | "function";
  id: string;
  line: number;
  order: number;
}

export interface FileInfo {
  path: string;
  module: string;
  items: FileItem[];
  classes: ClassInfo[];
  functions: FunctionInfo[];
}

export interface CallEdge {
  source: string;
  target: string;
  line: number;
}

export interface Analysis {
  files: FileInfo[];
  edges: CallEdge[];
  filesScanned: number;
  warnings: string[];
}
