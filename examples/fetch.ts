/**
 * Example: Fixed-output derivation (fetcher)
 * 
 * Fixed-output derivations are identified by their OUTPUT hash,
 * not their build recipe. This enables network access during build
 * (since the output is verified against the expected hash).
 */

import { fetchUrl, sh, build } from '../src/index.js';

// Fetch a file from the internet
// The sha256 hash ensures we get exactly what we expect
const jqBinary = fetchUrl({
  name: 'jq-linux64',
  url: 'https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64',
  sha256: 'af986793a515d500ab2d35f8d2aecd656e764504b789b66d7e1a0b727a124c44',
});

// Use the fetched file in another derivation
const withJq = sh`
  mkdir -p $out/bin
  cp ${jqBinary} $out/bin/jq
  chmod +x $out/bin/jq
`;

export { jqBinary, withJq };
export default jqBinary;
