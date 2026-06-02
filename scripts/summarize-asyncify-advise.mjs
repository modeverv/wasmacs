import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const inputPath = process.env.WASMACS_ASYNCIFY_ADVISE_LOG
  ?? join(repoRoot, "logs/wasm-browser-asyncify-advise.txt");
const outputPath = process.env.WASMACS_ASYNCIFY_ADVISE_SUMMARY
  ?? join(repoRoot, "logs/wasm-browser-asyncify-advise-summary.txt");

const focusNames = [
  "wasmacs_host_wait_for_input",
  "wasmacs_command_begin_minibuffer_force_probe",
  "wasmacs_read_minibuffer_probe_body",
  "Fread_from_minibuffer",
  "read_minibuf",
  "recursive_edit_1",
  "command_loop",
  "command_loop_1",
  "read_key_sequence",
  "read_key_sequence_vs",
  "read_char",
  "read_filtered_event",
  "read_event_from_main_queue",
  "read_decoded_event_from_main_queue",
  "kbd_buffer_get_event",
  "tty_read_avail_input",
  "wait_reading_process_output",
];

const text = await readFile(inputPath, "utf8");
const lines = text.split(/\r?\n/);
const byName = new Map(focusNames.map((name) => [name, []]));

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (!line.includes("[asyncify]")) continue;

  for (const name of focusNames) {
    const pattern = new RegExp(`\\b${name}\\b`);
    if (pattern.test(line)) {
      byName.get(name).push({ lineNumber: index + 1, line });
    }
  }
}

const output = [
  "CASE:asyncify-advise-summary",
  `SOURCE:${inputPath}`,
  "",
];

for (const name of focusNames) {
  const matches = byName.get(name);
  output.push(`FUNCTION:${name}`);
  output.push(`COUNT:${matches.length}`);
  for (const match of matches.slice(0, 8)) {
    output.push(`${match.lineNumber}:${match.line}`);
  }
  if (matches.length > 8) {
    output.push(`OMITTED:${matches.length - 8}`);
  }
  output.push("");
}

await writeFile(outputPath, `${output.join("\n")}\n`);

const missing = focusNames.filter((name) => byName.get(name).length === 0);
if (missing.length > 0) {
  throw new Error(`missing asyncify advise entries: ${missing.join(", ")}`);
}

console.log(`asyncify advise summary written to ${outputPath}`);
