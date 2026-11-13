/* Early-warning scan of plugin files. The sandbox enforces the rules at run time; this tells the author (and the admin) up front. */
const SERVER_BLOCK = [
  [/\brequire\s*\(\s*['"`](?:node:)?(?:child_process|worker_threads|cluster|net|tls|http|https|http2|dgram|dns|fs|os|vm|v8|inspector|repl|wasi|module|process)['"`]/, "loads a Node module that plugins are not allowed to use"],
  [/\bimport\s*\(|^\s*import\s+[\w{*'"]|^\s*export\s/m, "uses ES module syntax (use require and module.exports)"],
  [/\bprocess\s*\.\s*(?:binding|dlopen|mainModule|_linkedBinding)\b/, "reaches for Node internals"],
  [/\b(?:eval|Function)\s*\(/, "builds code from text"],
  [/\bconstructor\s*\.\s*constructor\b/, "tries to reach the Function constructor"]
];
const RESERVED_GLOBALS = ["status", "name", "top", "length", "event", "frames", "location", "history", "parent", "self", "opener", "closed", "origin"];
const CLIENT_WARN = [
  [new RegExp("\\b(?:var|let|const)\\b[^;{}]*?[,\\s](?:" + RESERVED_GLOBALS.join("|") + ")\\s*="), "declares a variable named after a reserved browser global (e.g. \"status\", \"name\", \"top\"); assigning to it can silently fail or coerce to text instead of holding your value"],
  [/\beval\s*\(|new\s+Function\s*\(/, "builds code from text (will not run: blocked by the browser policy)"],
  [/document\s*\.\s*cookie|\blocalStorage\b|\bsessionStorage\b/, "uses cookies or browser storage (not available inside the plugin sandbox; use a collection or the server API instead)"],
  [/<script[^>]+src\s*=\s*["']\s*(?:https?:)?\/\//i, "loads a script from another website (will be blocked)"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b[^;\n]{0,60}["'`]\s*(?:https?:)?\/\//, "talks to another website (will be blocked; plugins may only call their own /x-api/ address)"],
  [/<iframe\b|<object\b|<embed\b/i, "embeds other content"]
];
exports.scan = (file, text, isServer) => {
  const out = [];
  for (const [re, msg] of isServer ? SERVER_BLOCK : CLIENT_WARN) if (re.test(text)) out.push({ level: isServer ? "block" : "warn", file, msg });
  if (text.split("\n").some(l => l.length > 3000)) out.push({ level: "warn", file, msg: "has very long lines (minified or obfuscated code is hard to review)" });
  return out;
};
