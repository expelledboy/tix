/**
 * Example with dependencies
 */
import { drv, build, env } from "../src";

// A "library" that provides some data
export const greetings = drv({
  name: "greetings",
  builder: "/bin/sh",
  args: ["-c", `
    mkdir -p $out/share
    echo "Hello" > $out/share/en.txt
    echo "Hola" > $out/share/es.txt
    echo "Bonjour" > $out/share/fr.txt
  `],
});

// A "program" that depends on the library
export const greeter = drv({
  name: "greeter",
  builder: "/bin/sh",
  args: ["-c", `
    mkdir -p $out/bin
    cat > $out/bin/greet << SCRIPT
#!/bin/sh
LANG=\${1:-en}
cat $input0/share/\$LANG.txt 2>/dev/null || echo "Unknown language"
SCRIPT
    chmod +x $out/bin/greet
  `],
  inputs: [greetings],
});

// Development environment with both
export const devEnv = env({
  name: "greeter-dev",
  packages: [greeter],
});

if (import.meta.url === `file://${process.argv[1]}`) {
  build(greeter).then(console.log);
}
