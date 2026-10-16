import esbuild from "esbuild";
import process from "process";
import { builtinModules as builtins } from "node:module";
import { readFileSync } from "node:fs";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian", "electron",
    "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language",
    "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view",
    "@lezer/common", "@lezer/highlight", "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  legalComments: "eof",
  banner: { js: `/*! Obsidian Citizen fork maintained by J117W3.\n${readFileSync(new URL("./LICENSE", import.meta.url), "utf8").replace(/\*\//g, "* /")}\n*/` },
  outfile: "main.js",
});

if (prod) { await context.rebuild(); process.exit(0); }
else { await context.watch(); }
