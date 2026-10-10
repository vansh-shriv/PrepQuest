import type { Language, Signature } from "./types.js";

// Per-language drivers for function-style problems (doc 12 "Driver I/O contract").
// Each reads the canonical stdin format, calls `Solution.<function>`, and prints the canonical result.
// `packages/content/python/harness.py` is the executable reference; `drivers.test.ts` checks these
// against it for every shipped problem.

export interface SourceFile {
  name: string;
  content: string;
}

const split = (type: string) => ({
  base: type.replace(/\[\]/g, ""),
  dims: (type.match(/\[\]/g) ?? []).length,
});

export function buildSources(language: Language, code: string, signature: Signature): SourceFile[] {
  const user = code.endsWith("\n") ? code : `${code}\n`;
  switch (language) {
    case "python":
      return [{ name: "main.py", content: `${user}\n${pythonDriver(signature)}` }];
    case "cpp":
      return [{ name: "main.cpp", content: cppSource(user, signature) }];
    case "java":
      return [
        { name: "Solution.java", content: user },
        { name: "Main.java", content: javaDriver(signature) },
      ];
  }
}

// ------------------------------------------------------------------ Python

function pythonDriver(sig: Signature): string {
  const spec = JSON.stringify({
    fn: sig.function,
    params: sig.params.map((p) => p.type),
    returns: sig.returns,
  });
  return String.raw`# ---- PrepQuest driver (generated; not part of your solution) ----
import json as __pq_json
import sys as __pq_sys


def __pq_parse(base, token):
    if base in ("int", "long"):
        return int(token)
    if base == "double":
        return float(token)
    if base == "bool":
        return token == "true"
    return token


def __pq_fmt(base, value):
    if base in ("int", "long"):
        return str(int(value))
    if base == "double":
        return repr(float(value))
    if base == "bool":
        return "true" if value else "false"
    return str(value)


def __pq_read(lines, pos, type_):
    dims = type_.count("[]")
    base = type_.replace("[]", "")
    if dims == 0:
        value = __pq_parse(base, lines[pos[0]])
        pos[0] += 1
        return value, None
    n = int(lines[pos[0]])
    pos[0] += 1
    out = []
    if dims == 1 and base == "string":
        for _ in range(n):
            out.append(lines[pos[0]])
            pos[0] += 1
        return out, None
    if dims == 1:
        line = lines[pos[0]]
        pos[0] += 1
        tokens = line.split(" ") if line != "" else []
        return [__pq_parse(base, t) for t in tokens], None
    for _ in range(n):
        tokens = lines[pos[0]].split(" ")
        pos[0] += 1
        out.append([__pq_parse(base, t) for t in tokens[1:]])
    return out, None


def __pq_write(type_, value):
    dims = type_.count("[]")
    base = type_.replace("[]", "")
    if value is None:
        raise TypeError("your function returned None")
    if dims == 0:
        return __pq_fmt(base, value) + "\n"
    if dims == 1 and base == "string":
        return str(len(value)) + "\n" + "".join(__pq_fmt(base, v) + "\n" for v in value)
    if dims == 1:
        return str(len(value)) + "\n" + " ".join(__pq_fmt(base, v) for v in value) + "\n"
    rows = "".join(" ".join([str(len(r))] + [__pq_fmt(base, v) for v in r]) + "\n" for r in value)
    return str(len(value)) + "\n" + rows


def __pq_main():
    spec = __pq_json.loads(r'''${spec}''')
    text = __pq_sys.stdin.buffer.read().decode("utf8")
    lines = text.split("\n")
    pos = [0]
    args = []
    for t in spec["params"]:
        value, _ = __pq_read(lines, pos, t)
        args.append(value)
    result = getattr(Solution(), spec["fn"])(*args)
    __pq_sys.stdout.buffer.write(__pq_write(spec["returns"], result).encode("utf8"))
    __pq_sys.stdout.flush()


if __name__ == "__main__":
    __pq_main()
`;
}

// ------------------------------------------------------------------ C++

const CPP_TYPE: Record<string, string> = {
  int: "int",
  long: "long long",
  double: "double",
  bool: "bool",
  string: "string",
};

function cppType(type: string): string {
  const { base, dims } = split(type);
  let t = CPP_TYPE[base] as string;
  for (let i = 0; i < dims; i++) t = `vector<${t}>`;
  return t;
}

function cppSource(user: string, sig: Signature): string {
  const decls = sig.params.map((p, i) => `  ${cppType(p.type)} a${i}; pq::read(a${i});`).join("\n");
  const call = sig.params.map((_, i) => `a${i}`).join(", ");
  // The prelude carries the usual headers; `#line` keeps compiler messages on the user's line numbers.
  return `#include <bits/stdc++.h>
using namespace std;
#line 1 "main.cpp"
${user}
${CPP_DRIVER}
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
${decls}
  Solution pq_solution;
  ${cppType(sig.returns)} pq_result = pq_solution.${sig.function}(${call});
  pq::write(pq_result);
  return 0;
}
`;
}

const CPP_DRIVER = String.raw`// ---- PrepQuest driver (generated; not part of your solution) ----
#line 1 "pq_driver.cpp"
namespace pq {
static string line() {
  string s;
  if (!getline(cin, s)) { fprintf(stderr, "driver: unexpected end of input\n"); exit(2); }
  return s;
}
static vector<string> words(const string& s) {
  vector<string> out;
  size_t i = 0;
  while (i <= s.size() && !s.empty()) {
    size_t j = s.find(' ', i);
    if (j == string::npos) j = s.size();
    out.push_back(s.substr(i, j - i));
    i = j + 1;
  }
  return out;
}
static void parse(const string& t, int& v) { v = stoi(t); }
static void parse(const string& t, long long& v) { v = stoll(t); }
static void parse(const string& t, double& v) { v = stod(t); }
static void parse(const string& t, bool& v) { v = (t == "true"); }
static void parse(const string& t, string& v) { v = t; }

template <class T> void read(T& v) { parse(line(), v); }
template <class T> void read(vector<T>& v) {
  long long n = stoll(line());
  string l = line();
  v.clear();
  for (const string& t : words(l)) { T x; parse(t, x); v.push_back(x); }
  if ((long long)v.size() != n) { fprintf(stderr, "driver: expected %lld values\n", n); exit(2); }
}
static void read(vector<string>& v) {
  long long n = stoll(line());
  v.clear();
  for (long long i = 0; i < n; i++) v.push_back(line());
}
template <class T> void read(vector<vector<T>>& v) {
  long long n = stoll(line());
  v.clear();
  for (long long i = 0; i < n; i++) {
    vector<string> w = words(line());
    vector<T> row;
    for (size_t j = 1; j < w.size(); j++) { T x; parse(w[j], x); row.push_back(x); }
    v.push_back(row);
  }
}

static string fmt(int v) { return to_string(v); }
static string fmt(long long v) { return to_string(v); }
static string fmt(double v) { char b[64]; snprintf(b, sizeof b, "%.17g", v); return b; }
static string fmt(bool v) { return v ? "true" : "false"; }
static string fmt(const string& v) { return v; }

template <class T> void write(const T& v) { cout << fmt(v) << "\n"; }
template <class T> void write(const vector<T>& v) {
  cout << v.size() << "\n";
  for (size_t i = 0; i < v.size(); i++) { if (i) cout << ' '; cout << fmt(v[i]); }
  cout << "\n";
}
static void write(const vector<string>& v) {
  cout << v.size() << "\n";
  for (const string& s : v) cout << s << "\n";
}
template <class T> void write(const vector<vector<T>>& v) {
  cout << v.size() << "\n";
  for (const auto& row : v) {
    cout << row.size();
    for (const auto& x : row) cout << ' ' << fmt(x);
    cout << "\n";
  }
}
}  // namespace pq
`;

// ------------------------------------------------------------------ Java

const JAVA_TYPE: Record<string, string> = {
  int: "int",
  long: "long",
  double: "double",
  bool: "boolean",
  string: "String",
};
const JAVA_PARSE: Record<string, (e: string) => string> = {
  int: (e) => `Integer.parseInt(${e})`,
  long: (e) => `Long.parseLong(${e})`,
  double: (e) => `Double.parseDouble(${e})`,
  bool: (e) => `${e}.equals("true")`,
  string: (e) => e,
};
const JAVA_FMT: Record<string, (e: string) => string> = {
  int: (e) => `String.valueOf(${e})`,
  long: (e) => `String.valueOf(${e})`,
  double: (e) => `Double.toString(${e})`,
  bool: (e) => `(${e} ? "true" : "false")`,
  string: (e) => e,
};

const javaType = (type: string) => {
  const { base, dims } = split(type);
  return (JAVA_TYPE[base] as string) + "[]".repeat(dims);
};
const mangle = (type: string) => {
  const { base, dims } = split(type);
  return `${base}_${dims}`;
};

function javaReader(type: string): string {
  const { base, dims } = split(type);
  const t = JAVA_TYPE[base] as string;
  const parse = JAVA_PARSE[base] as (e: string) => string;
  const name = `rd_${mangle(type)}`;
  if (dims === 0) return `static ${t} ${name}() throws IOException { return ${parse("line()")}; }`;
  if (dims === 1 && base === "string") {
    return `static String[] ${name}() throws IOException {
    int n = Integer.parseInt(line());
    String[] r = new String[n];
    for (int i = 0; i < n; i++) r[i] = line();
    return r;
  }`;
  }
  if (dims === 1) {
    return `static ${t}[] ${name}() throws IOException {
    int n = Integer.parseInt(line());
    String l = line();
    ${t}[] r = new ${t}[n];
    if (n > 0) {
      String[] w = l.split(" ");
      if (w.length != n) { System.err.println("driver: expected " + n + " values"); System.exit(2); }
      for (int i = 0; i < n; i++) r[i] = ${parse("w[i]")};
    }
    return r;
  }`;
  }
  return `static ${t}[][] ${name}() throws IOException {
    int n = Integer.parseInt(line());
    ${t}[][] r = new ${t}[n][];
    for (int i = 0; i < n; i++) {
      String[] w = line().split(" ");
      int k = Integer.parseInt(w[0]);
      r[i] = new ${t}[k];
      for (int j = 0; j < k; j++) r[i][j] = ${parse("w[j + 1]")};
    }
    return r;
  }`;
}

function javaWriter(type: string): string {
  const { base, dims } = split(type);
  const t = JAVA_TYPE[base] as string;
  const fmt = JAVA_FMT[base] as (e: string) => string;
  const name = `wr_${mangle(type)}`;
  if (dims === 0)
    return `static void ${name}(StringBuilder sb, ${t} v) { sb.append(${fmt("v")}).append('\\n'); }`;
  if (dims === 1 && base === "string") {
    return `static void ${name}(StringBuilder sb, String[] v) {
    sb.append(v.length).append('\\n');
    for (String s : v) sb.append(s).append('\\n');
  }`;
  }
  if (dims === 1) {
    return `static void ${name}(StringBuilder sb, ${t}[] v) {
    sb.append(v.length).append('\\n');
    for (int i = 0; i < v.length; i++) { if (i > 0) sb.append(' '); sb.append(${fmt("v[i]")}); }
    sb.append('\\n');
  }`;
  }
  return `static void ${name}(StringBuilder sb, ${t}[][] v) {
    sb.append(v.length).append('\\n');
    for (${t}[] row : v) {
      sb.append(row.length);
      for (${t} x : row) sb.append(' ').append(${fmt("x")});
      sb.append('\\n');
    }
  }`;
}

function javaDriver(sig: Signature): string {
  const readers = [...new Set(sig.params.map((p) => p.type))].map(javaReader).join("\n  ");
  const writer = javaWriter(sig.returns);
  const decls = sig.params
    .map((p, i) => `    ${javaType(p.type)} a${i} = rd_${mangle(p.type)}();`)
    .join("\n");
  const call = sig.params.map((_, i) => `a${i}`).join(", ");
  return `import java.io.*;
import java.nio.charset.StandardCharsets;

// ---- PrepQuest driver (generated; not part of your solution) ----
public class Main {
  static BufferedReader br;
  static String line() throws IOException {
    String s = br.readLine();
    if (s == null) { System.err.println("driver: unexpected end of input"); System.exit(2); }
    return s;
  }
  ${readers}
  ${writer}
  public static void main(String[] args) throws Exception {
    br = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8), 1 << 16);
${decls}
    ${javaType(sig.returns)} result = new Solution().${sig.function}(${call});
    StringBuilder sb = new StringBuilder();
    wr_${mangle(sig.returns)}(sb, result);
    PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), false, "UTF-8");
    out.print(sb);
    out.flush();
  }
}
`;
}
