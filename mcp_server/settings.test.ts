import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettingsPatch, parseIdleApps, serializeIdleApps, KNOWN_SETTING_KEYS } from "./settings.ts";

test("parseIdleApps splits a CSV and trims whitespace", () => {
  assert.deepEqual(parseIdleApps("fire, clock ,snow"), ["fire", "clock", "snow"]);
});

test("parseIdleApps returns [] for empty string", () => {
  assert.deepEqual(parseIdleApps(""), []);
});

test("serializeIdleApps joins list with commas (no spaces)", () => {
  assert.equal(serializeIdleApps(["fire", "snow"]), "fire,snow");
});

test("normalizeSettingsPatch keeps only known keys, drops unknown", () => {
  const out = normalizeSettingsPatch({ idle_after_secs: 300, bogus: 1 });
  assert.deepEqual(out, { idle_after_secs: 300 });
});

test("normalizeSettingsPatch coerces numeric strings to numbers", () => {
  assert.deepEqual(normalizeSettingsPatch({ idle_brightness: "5" }), { idle_brightness: 5 });
});

test("normalizeSettingsPatch coerces string 'true' to boolean true", () => {
  assert.deepEqual(normalizeSettingsPatch({ idle_enabled: "true" }), { idle_enabled: true });
});

test("normalizeSettingsPatch coerces boolean true to boolean true", () => {
  assert.deepEqual(normalizeSettingsPatch({ idle_enabled: true }), { idle_enabled: true });
});

test("normalizeSettingsPatch keeps idle_random and coerces it to boolean", () => {
  assert.deepEqual(normalizeSettingsPatch({ idle_random: false }), { idle_random: false });
  assert.deepEqual(normalizeSettingsPatch({ idle_random: "true" }), { idle_random: true });
});

test("normalizeSettingsPatch keeps the MQTT keys with correct types", () => {
  const out = normalizeSettingsPatch({
    mqtt_enabled: "true", mqtt_host: "192.168.1.50", mqtt_port: "1883", mqtt_every_secs: "3",
  });
  assert.deepEqual(out, { mqtt_enabled: true, mqtt_host: "192.168.1.50", mqtt_port: 1883, mqtt_every_secs: 3 });
});

test("KNOWN_SETTING_KEYS contains idle_after_secs and timezone", () => {
  assert.ok(KNOWN_SETTING_KEYS.includes("idle_after_secs"), "expected idle_after_secs");
  assert.ok(KNOWN_SETTING_KEYS.includes("timezone"), "expected timezone");
});
