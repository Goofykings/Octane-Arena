import { build } from "esbuild";
await build({
  entryPoints: ["src/index.ts", "src/lan.ts", "src/backup.ts", "src/app.ts"],
  outdir: "dist/server/src",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  sourcemap: true,
});
