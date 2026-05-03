/**
 * Un solo paso: git add → commit (si hay cambios) → push a origin.
 *
 * Uso:
 *   npm run ship -- "mensaje del commit"
 *
 * Si no hay nada nuevo que commitear pero hay commits locales sin subir, hace push igual.
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd) {
  execSync(cmd, { stdio: "inherit", cwd: root, shell: true });
}

function out(cmd) {
  return execSync(cmd, { encoding: "utf8", cwd: root, shell: true }).trim();
}

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error('Falta el mensaje. Ejemplo: npm run ship -- "fix: API directo a Render"');
  process.exit(1);
}

function hasStagedDiff() {
  try {
    execSync("git diff --cached --quiet", { cwd: root });
    return false;
  } catch {
    return true;
  }
}

run("git add -A");

if (hasStagedDiff()) {
  run(`git commit -m ${JSON.stringify(message)}`);
} else {
  console.log("Sin cambios nuevos en el índice (git add no agregó nada distinto).");
}

const branch = out("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  console.warn(`Aviso: estás en la rama "${branch}", no en main. El push irá a origin/${branch}.`);
}

run(`git push origin ${branch}`);
console.log(`Listo: origin/${branch} actualizado. Si Vercel está ligado a GitHub, debería arrancar un deploy.`);
