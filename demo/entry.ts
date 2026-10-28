// Demo entry: installs the mocked Tauri bridge, then boots the real, unmodified app.
import { installMockBridge } from "./mock";

installMockBridge();
await import("/src/main.tsx");
