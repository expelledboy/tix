/**
 * Example: Hello World
 * 
 * Run with: tix build examples/hello.ts
 */

import { sh, build } from '../src/index.js';

// Simple shell-based derivation
export const hello = sh`
  mkdir -p $out/bin
  
  cat > $out/bin/hello << 'EOF'
#!/bin/sh
echo "Hello from Tix!"
EOF
  
  chmod +x $out/bin/hello
`;

// Build it if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const outPath = await build(hello);
  console.log(`Built: ${outPath}`);
  console.log(`Run: ${outPath}/bin/hello`);
}

export default hello;
