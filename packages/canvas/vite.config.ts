import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import { resolve } from "node:path";

export default defineConfig({
    plugins: [react(), dts({ include: ["src"], rollupTypes: false })],
    build: {
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            name: "MaxFlowCanvas",
            formats: ["es"],
            fileName: "index",
        },
        rollupOptions: {
            external: ["react", "react-dom", "react/jsx-runtime", "zustand", "lucide-react"],
        },
        cssCodeSplit: false,
    },
});
