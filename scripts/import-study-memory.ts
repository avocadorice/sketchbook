import { readFileSync, writeFileSync } from "node:fs";
import { checkpoint, createAttempt, sceneAt } from "../src/history";
import { parseImport, type Project, type PastAttempt } from "../src/storage";

// Run against a SQLite backup exported to JSON, never the live Study Memory database.
const [projectFile, studyFile, outputFile] = process.argv.slice(2);
if (!projectFile || !studyFile || !outputFile) throw new Error("Expected project.json study-import.json output.json");
const record = JSON.parse(readFileSync(projectFile, "utf8"));
const project = parseImport(JSON.stringify(record));
const study = JSON.parse(readFileSync(studyFile, "utf8"));
const imported: PastAttempt[] = [];
for (const point of study.points) {
  const scene = study.drawings[point.id];
  const drawing = scene ? parseImport(JSON.stringify(scene), point.title) : null;
  let attempt = drawing?.attempt ?? createAttempt(point.title || "Study note");
  const notes = [
    point.url ? `Source: ${point.url}` : "",
    point.anchor?.quote ? `Quote: ${point.anchor.quote}` : "",
    point.question ? `Question: ${point.question}` : "",
    point.understanding ? `Understanding: ${point.understanding}` : "",
    ...(point.turns ?? []).map((turn: { role: string; content: string }) => `${turn.role}: ${turn.content}`),
  ].filter(Boolean).join("\n\n");
  // Long conversations become consecutive notes checkpoints without truncating their text.
  for (let offset = 0; offset < Math.max(notes.length, 1); offset += 20000) {
    attempt = checkpoint(attempt, sceneAt(attempt), offset ? "Study notes (continued)" : "Study notes", notes.slice(offset, offset + 20000));
  }
  if (drawing) Object.assign(project.files, drawing.files);
  const index = attempt.chapters.length - 1;
  imported.push({ savedAt: Date.parse(point.updatedAt), attempt, draft: { index, scene: sceneAt(attempt), title: attempt.chapters[index].title, notes: attempt.chapters[index].notes } });
}
const result: Project = { ...project, past: [...(project.past ?? []), ...imported] };
// Validate the entire migrated library before it can replace a live store.
parseImport(JSON.stringify(result));
writeFileSync(outputFile, JSON.stringify({ ...record, project: result }), { mode: 0o600, flag: "wx" });
console.log(`Kept all Nexo checkpoints/drafts; imported ${imported.length} Study Memory drawings and notes.`);
