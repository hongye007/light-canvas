import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "packages/canvas");
const destination = join(root, "artifacts");
const staging = mkdtempSync(join(tmpdir(), "maxflow-canvas-"));

try {
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const { name, version, type, license, dependencies, peerDependencies } = manifest;
    mkdirSync(destination, { recursive: true });
    cpSync(join(source, "dist"), join(staging, "dist"), { recursive: true });
    cpSync(join(root, "README.md"), join(staging, "README.md"));
    cpSync(join(root, "LICENSE"), join(staging, "LICENSE"));
    writeFileSync(join(staging, "package.json"), JSON.stringify({
        name, version, type, dependencies, peerDependencies,
        description: "Embeddable React canvas for connected text, image, and video workflows",
        license,
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: {
            ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
            "./styles.css": "./dist/index.css",
        },
        files: ["dist", "README.md", "LICENSE"],
        sideEffects: ["**/*.css"],
    }, null, 2) + "\n");
    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", destination], {
        cwd: staging, stdio: "inherit",
    });
} finally {
    rmSync(staging, { recursive: true, force: true });
}
