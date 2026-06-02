import { readFile, writeFile } from "node:fs/promises";

const repoRoot = new URL("..", import.meta.url).pathname;
const logsDir = `${repoRoot}/logs`;

async function readJson(name) {
  return JSON.parse(await readFile(`${logsDir}/${name}`, "utf8"));
}

async function readText(name) {
  return readFile(`${logsDir}/${name}`, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const project = await readJson("browser-project-file-smoke.txt");
const commands = await readJson("browser-command-dispatch-smoke.txt");
const switching = await readJson("browser-file-switch-smoke.txt");
const recovery = await readJson("browser-worker-recovery-smoke.txt");
const enterOpen = await readJson("browser-enter-open-smoke.txt");
const autosave = await readJson("browser-textarea-autosave-smoke.txt");
const undoQuit = await readJson("browser-undo-quit-smoke.txt");
const realUndo = await readText("wasm-browser-worker-real-undo.txt");
const realUndoUi = await readJson("browser-real-undo-ui-smoke.txt");
const repeatedUndoUi = await readJson("browser-repeated-undo-ui-smoke.txt");
const redoUi = await readJson("browser-redo-ui-smoke.txt");
const clipboard = await readJson("browser-clipboard-boundary-smoke.txt");
const runner = await readText("browser-runner-smoke.txt");

const session = {
  url: project.url,
  checks: [
    {
      name: "project file open/edit/save/reload",
      path: project.path,
      ok: project.path === "/home/user/projects/demo.txt" &&
        project.editor.includes("Saved by Emacs core.DEMO") &&
        project.state === "loaded",
    },
    {
      name: "command dispatch and process boundary",
      path: commands.beforeProcess.path,
      ok: commands.beforeProcess.editor.includes("Saved by Emacs core.A") &&
        commands.beforeProcess.status === "emacs command completed" &&
        commands.afterProcessFixed.status === "process unavailable" &&
        commands.afterProcessFixed.state === "process unavailable",
    },
    {
      name: "file switching",
      path: switching.path,
      ok: switching.path === "/home/user/projects/switch-a.txt" &&
        switching.editor.includes("A1") &&
        switching.files.some((entry) => entry.text === "~/projects/switch-a.txt" && entry.current) &&
        switching.files.some((entry) => entry.text === "~/projects/switch-b.txt"),
    },
    {
      name: "worker recovery after unavailable process",
      path: recovery.afterRecovery.path,
      ok: recovery.afterError.status === "process unavailable" &&
        recovery.afterRecovery.status === "emacs command completed" &&
        recovery.afterRecovery.editor === "REC",
    },
    {
      name: "relative path enter open",
      path: enterOpen.path,
      ok: enterOpen.path === "/home/user/projects/enter-open.txt" &&
        enterOpen.input === "/home/user/projects/enter-open.txt" &&
        enterOpen.files.includes("~/projects/enter-open.txt"),
    },
    {
      name: "textarea autosave before file switch",
      path: autosave.afterReturn.path,
      ok: autosave.afterDraft.path === "/home/user/projects/autosave-a.txt" &&
        autosave.afterDraft.editor === "TEXTAREA-DRAFT" &&
        autosave.afterDraft.state === "modified" &&
        autosave.afterSwitchAway.path === "/home/user/projects/autosave-b.txt" &&
        autosave.afterReturn.path === "/home/user/projects/autosave-a.txt" &&
        autosave.afterReturn.editor === "TEXTAREA-DRAFT" &&
        autosave.afterReturn.files.some((entry) => entry.text === "~/projects/autosave-a.txt" && entry.current),
    },
    {
      name: "keyboard quit visibility",
      path: undoQuit.afterKeyboardQuit.path,
      ok: undoQuit.afterInsert.path === "/home/user/projects/undo-quit.txt" &&
        undoQuit.afterInsert.editor === "U" &&
        undoQuit.afterKeyboardQuit.status === "keyboard quit" &&
        undoQuit.afterKeyboardQuit.state === "keyboard quit" &&
        undoQuit.afterKeyboardQuit.editor === "U",
    },
    {
      name: "real Emacs undo via persistent worker",
      path: "/home/user/worker-real-undo.txt",
      ok: realUndo.includes("INSERT_EVAL_STATUS:0") &&
        realUndo.includes("UNDO_EVAL_STATUS:0") &&
        realUndo.includes("UNDO_READBACK:/home/user/worker-real-undo.txt") &&
        realUndo.includes("FILE_TEXT:U\n"),
    },
    {
      name: "real Emacs undo via browser UI",
      path: realUndoUi.path,
      ok: realUndoUi.path.startsWith("/home/user/projects/real-undo-ui-") &&
        realUndoUi.status === "emacs command completed" &&
        realUndoUi.bufferState === "synced from emacs" &&
        realUndoUi.text === "" &&
        realUndoUi.output.includes("REAL_UNDO_UI_SMOKE:PASS"),
    },
    {
      name: "repeated real Emacs undo via browser UI",
      path: repeatedUndoUi.path,
      ok: repeatedUndoUi.path.startsWith("/home/user/projects/repeated-undo-ui-") &&
        repeatedUndoUi.status === "emacs command completed" &&
        repeatedUndoUi.bufferState === "synced from emacs" &&
        repeatedUndoUi.text === "" &&
        repeatedUndoUi.output.includes("REPEATED_UNDO_UI_SMOKE:PASS"),
    },
    {
      name: "real Emacs redo via browser UI",
      path: redoUi.path,
      ok: redoUi.path.startsWith("/home/user/projects/redo-ui-") &&
        redoUi.status === "emacs command completed" &&
        redoUi.bufferState === "synced from emacs" &&
        (redoUi.text === "A" || redoUi.text === "A\n") &&
        redoUi.output.includes("REDO_UI_SMOKE:PASS"),
    },
    {
      name: "clipboard and kill-ring boundary visibility",
      path: clipboard.afterYankUnavailable.path,
      ok: clipboard.afterInsert.path === "/home/user/projects/clipboard-boundary.txt" &&
        clipboard.afterInsert.editor === "CLIP" &&
        clipboard.afterYankUnavailable.status === "clipboard unavailable" &&
        clipboard.afterYankUnavailable.state === "clipboard unavailable" &&
        clipboard.afterYankUnavailable.editor === "CLIP" &&
        clipboard.afterYankUnavailable.output.includes("clipboard/kill-ring requires GUI clipboard protocol"),
    },
    {
      name: "repo-local browser runner all smoke",
      path: "logs/browser-runner-smoke.txt",
      ok: runner.includes("SCENARIOS:minibuffer,editing,files,boundaries") &&
        runner.includes("PASS minibuffer echo boundary") &&
        runner.includes("PASS real undo repeated undo redo browser hooks") &&
        runner.includes("PASS project reload file switching textarea autosave") &&
        runner.includes("PASS process clipboard keyboard quit boundaries"),
    },
  ],
};

for (const check of session.checks) {
  assert(check.ok, `browser editing session check failed: ${check.name}`);
}

await writeFile(
  `${logsDir}/browser-editing-session-smoke.txt`,
  `${session.checks.map((check) => `PASS ${check.name} ${check.path}`).join("\n")}\n`,
);

console.log("browser editing session summary passed");
