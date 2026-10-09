import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImport } from "./storage";
import { sceneAt } from "./history";

test("Excalidraw imports preserve live elements, images and background", () => {
  const file = { id: "image", mimeType: "image/png", dataURL: "data:image/png;base64,AA==", created: 1 };
  const project = parseImport(JSON.stringify({ type: "excalidraw", elements: [{ id: "box", type: "rectangle" }, { id: "removed", isDeleted: true }], appState: { viewBackgroundColor: "#123456" }, files: { image: file } }), "My diagram");
  assert.equal(project.attempt.prompt, "My diagram");
  assert.deepEqual(sceneAt(project.attempt).elements, [{ id: "box", type: "rectangle" }]);
  assert.equal(project.draft.scene.backgroundColor, "#123456");
  assert.deepEqual(project.files.image, file);
  assert.deepEqual(parseImport(JSON.stringify(project)), project);
});
