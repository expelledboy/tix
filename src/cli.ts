#!/usr/bin/env node
/**
 * Tix CLI
 * 
 * Usage:
 *   tix build <file.ts> [export]   Build a derivation
 *   tix show <file.ts> [export]    Show derivation details
 *   tix path <file.ts> [export]    Print output path
 *   tix gc                         Garbage collect unused paths
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
  const [,, command, file, exportName = "default"] = process.argv;
  
  if (!command) {
    console.log(`
Tix - A tiny TypeScript reimagining of Nix

Usage:
  tix build <file.ts> [export]   Build a derivation
  tix show <file.ts> [export]    Show derivation details  
  tix path <file.ts> [export]    Print output path
  tix gc                         Garbage collect

Examples:
  tix build ./hello.ts
  tix build ./hello.ts myPackage
  tix show ./hello.ts
`);
    process.exit(0);
  }
  
  if (command === "gc") {
    console.log("[tix] Garbage collection not yet implemented");
    process.exit(0);
  }
  
  if (!file) {
    console.error("Error: No file specified");
    process.exit(1);
  }
  
  // Import the module
  const modulePath = pathToFileURL(resolve(file)).href;
  const mod = await import(modulePath);
  const drv = mod[exportName];
  
  if (!drv || typeof drv !== "object" || !drv.name) {
    console.error(`Error: Export '${exportName}' is not a valid derivation`);
    process.exit(1);
  }
  
  // Import tix functions
  const { build, show, outPath } = await import("./api");
  
  switch (command) {
    case "build":
      const result = await build(drv);
      console.log(result);
      break;
      
    case "show":
      show(drv);
      break;
      
    case "path":
      console.log(outPath(drv));
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
