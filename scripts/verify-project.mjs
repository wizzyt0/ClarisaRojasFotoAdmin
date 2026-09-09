import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, extname, relative } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const errors = [];

function filesIn(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory() && ![".git", "node_modules"].includes(entry.name)) return filesIn(fullPath, extension);
    return entry.isFile() && extname(entry.name) === extension ? [fullPath] : [];
  });
}

const jsFiles = filesIn(root, ".js");
for (const file of jsFiles) {
  try {
    execFileSync("node", ["--check", file], { stdio: "pipe" });
  } catch (error) {
    errors.push(`Sintaxis inválida: ${relative(root, file)}\n${error.stderr?.toString() || error.message}`);
  }

  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const imported = resolve(dirname(file), match[1]);
    const candidates = [imported, `${imported}.js`, resolve(imported, "index.js")];
    if (!candidates.some(existsSync)) errors.push(`Import local roto: ${relative(root, file)} → ${match[1]}`);
  }
}

for (const file of filesIn(root, ".html")) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
    const scriptPath = match[1].split("?")[0];
    if (/^(https?:|\/)/.test(scriptPath)) continue;
    if (!existsSync(resolve(dirname(file), scriptPath))) errors.push(`Script HTML roto: ${relative(root, file)} → ${scriptPath}`);
  }
}

const wrapper = readFileSync(resolve(root, "js/supabase.js"), "utf8");
const requiredQueryMethods = ["select", "insert", "update", "delete", "upsert", "eq", "in", "order", "limit", "single", "maybeSingle"];
for (const method of requiredQueryMethods) {
  if (!new RegExp(`\\b${method}\\(\\.\\.\\.args\\)`).test(wrapper)) errors.push(`El adaptador Supabase no implementa .${method}().`);
}

if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}

console.log(`Verificación correcta: ${jsFiles.length} archivos JavaScript, imports locales y scripts HTML.`);
