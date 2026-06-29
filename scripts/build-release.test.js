import { test } from "node:test";
import assert from "node:assert/strict";
import { pickHighestVersionPath } from "./build-release.mjs";

test("pickHighestVersionPath prefers the highest dotted-number segment", () => {
  const paths = [
    "/p/esp32/tools/esptool_py/4.5.1/esptool.exe",
    "/p/esp32/tools/esptool_py/5.2.0/esptool.exe",
  ];
  assert.equal(pickHighestVersionPath(paths), "/p/esp32/tools/esptool_py/5.2.0/esptool.exe");
});

test("pickHighestVersionPath returns the sole path unchanged", () => {
  assert.equal(pickHighestVersionPath(["/only/3.0.0/mklittlefs.exe"]), "/only/3.0.0/mklittlefs.exe");
});
