import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@excalidraw/excalidraw/index.css";
import "./app.css";

window.EXCALIDRAW_ASSET_PATH = new URL("./excalidraw-assets/", document.baseURI).href;
createRoot(document.getElementById("root")!).render(<App />);
