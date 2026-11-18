export {};

declare global {
  interface Window {
    sketchbookFlushDraft?: () => Promise<void>;
    EXCALIDRAW_ASSET_PATH: string;
    practicePadFlushDraft?: () => Promise<void>;
    interviewPadCapture?: () => Promise<string>;
  }
}
