'use strict';
// Shell constructs that hide a failing exit status: `cmd || true`, `cmd; true`, `cmd; exit 0`, `set +e`.
// A command like this recorded as evidence would show exit 0 whatever happened, so `adlc run` refuses it
// and the guard denies it before it is attempted. (Pipes without pipefail also mask a status; not covered.)
const MASKING = [
  /\|\|\s*(true\b|:(\s|$|[;&|)])|exit\s+0\b|echo\b|printf\b)/,
  /;\s*(true|:|exit\s+0)\s*($|[;&|)\n'"])/,
  /(^|[\s;&|(])set\s+\+e\b/,
];

const masksExitStatus = (cmd) => MASKING.some((re) => re.test(String(cmd)));

module.exports = { MASKING, masksExitStatus };
