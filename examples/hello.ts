/**
 * Hello World example for Tix
 */
import { sh, drv, build } from "../src";

// Simple shell derivation
export const hello = sh`
  mkdir -p $out/bin
  echo '#!/bin/sh' > $out/bin/hello
  echo 'echo "Hello from Tix!"' >> $out/bin/hello
  chmod +x $out/bin/hello
`;

// Explicit derivation
export const helloExplicit = drv({
  name: "hello-explicit",
  builder: "/bin/sh",
  args: ["-c", `
    mkdir -p $out/bin
    cat > $out/bin/hello << 'SCRIPT'
#!/bin/sh
echo "Hello from explicit derivation!"
SCRIPT
    chmod +x $out/bin/hello
  `],
});

// Build if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  build(hello).then(console.log);
}
