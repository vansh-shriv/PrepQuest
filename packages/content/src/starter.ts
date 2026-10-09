import type { Language, ParamType, Signature } from "./types.js";

const PY: Record<string, string> = {
  int: "int",
  long: "int",
  double: "float",
  bool: "bool",
  string: "str",
};
const JAVA: Record<string, string> = {
  int: "int",
  long: "long",
  double: "double",
  bool: "boolean",
  string: "String",
};
const CPP: Record<string, string> = {
  int: "int",
  long: "long long",
  double: "double",
  bool: "bool",
  string: "string",
};

function parts(type: ParamType) {
  const dims = (type.match(/\[\]/g) ?? []).length;
  return { base: type.replace(/\[\]/g, ""), dims };
}

function pyType(type: ParamType): string {
  const { base, dims } = parts(type);
  let t = PY[base] as string;
  for (let i = 0; i < dims; i++) t = `list[${t}]`;
  return t;
}

function javaType(type: ParamType): string {
  const { base, dims } = parts(type);
  return (JAVA[base] as string) + "[]".repeat(dims);
}

function cppType(type: ParamType, asParam: boolean): string {
  const { base, dims } = parts(type);
  let t = CPP[base] as string;
  for (let i = 0; i < dims; i++) t = `vector<${t}>`;
  return asParam && dims > 0 ? `${t}&` : t;
}

const JAVA_DEFAULT: Record<string, string> = {
  int: "0",
  long: "0L",
  double: "0.0",
  boolean: "false",
  String: '""',
};

function javaDefault(type: ParamType): string {
  const t = javaType(type);
  if (JAVA_DEFAULT[t]) return JAVA_DEFAULT[t] as string;
  const { base, dims } = parts(type);
  // empty array of the right shape
  return `new ${JAVA[base]}${"[0]".repeat(dims)}`;
}

/** Starter code shown in the editor, generated from the signature (authors may override per language). */
export function generateStarter(language: Language, sig: Signature): string {
  const name = sig.function;
  switch (language) {
    case "python": {
      const params = sig.params.map((p) => `${p.name}: ${pyType(p.type)}`).join(", ");
      return `class Solution:\n    def ${name}(self, ${params}) -> ${pyType(sig.returns)}:\n        pass\n`;
    }
    case "java": {
      const params = sig.params.map((p) => `${javaType(p.type)} ${p.name}`).join(", ");
      return `class Solution {\n    public ${javaType(sig.returns)} ${name}(${params}) {\n        // write your code here\n        return ${javaDefault(sig.returns)};\n    }\n}\n`;
    }
    case "cpp": {
      const params = sig.params.map((p) => `${cppType(p.type, true)} ${p.name}`).join(", ");
      return `#include <bits/stdc++.h>\nusing namespace std;\n\nclass Solution {\npublic:\n    ${cppType(sig.returns, false)} ${name}(${params}) {\n        // write your code here\n        return {};\n    }\n};\n`;
    }
  }
}
