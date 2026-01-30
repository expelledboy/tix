/**
 * Example: Derivation with dependencies
 * 
 * Shows how derivations can depend on each other.
 */

import { sh, drv, build } from '../src/index.js';

// First, a library
const myLib = sh`
  mkdir -p $out/lib
  echo 'export const greet = (name) => "Hello, " + name;' > $out/lib/greet.js
`;

// Then, an app that uses the library
const myApp = sh`
  mkdir -p $out/bin
  
  # Reference the library via $input0
  cat > $out/bin/app << EOF
#!/usr/bin/env node
const { greet } = require('${myLib}/lib/greet.js');
console.log(greet(process.argv[2] || 'World'));
EOF
  
  chmod +x $out/bin/app
`;

// Alternative: explicit derivation with named inputs
const myAppExplicit = drv({
  name: 'my-app',
  builder: '/bin/sh',
  args: ['-c', `
    mkdir -p $out/bin
    cat > $out/bin/app << 'SCRIPT'
#!/usr/bin/env node
console.log("Hello from explicit derivation!");
SCRIPT
    chmod +x $out/bin/app
  `],
  inputs: [myLib],
  env: {
    MY_LIB: '$input0',  // Will be replaced with myLib's output path
  },
});

export { myLib, myApp, myAppExplicit };
export default myApp;
