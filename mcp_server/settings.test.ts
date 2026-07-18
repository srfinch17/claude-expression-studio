import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSettingsPatch, parseIdleApps, serializeIdleApps,
  KNOWN_SETTING_KEYS, NUMERIC_KEYS, BOOLEAN_KEYS,
} from "./settings.ts";

test("parseIdleApps splits a CSV and trims whitespace", () => {
  assert.deepEqual(parseIdleApps("fire, clock ,snow"), ["fire", "clock", "snow"]);
});

test("parseIdleApps returns [] for empty string", () => {
  assert.deepEqual(parseIdleApps(""), []);
});

test("serializeIdleApps joins list with commas (no spaces)", () => {
  assert.equal(serializeIdleApps(["fire", "snow"]), "fire,snow");
});

test("normalizeSettingsPatch keeps known keys and names unknown ones in ignored", () => {
  const { patch, ignored } = normalizeSettingsPatch({ idle_after_secs: 300, bogus: 1 });
  assert.deepEqual(patch, { idle_after_secs: 300 });
  assert.deepEqual(ignored, ["bogus (unknown setting)"]);
});

test("normalizeSettingsPatch coerces numeric strings to numbers", () => {
  assert.deepEqual(normalizeSettingsPatch({ idle_brightness: "5" }).patch, { idle_brightness: 5 });
});

test("normalizeSettingsPatch accepts every common truthy/falsy boolean spelling", () => {
  for (const v of [true, "true", 1, "1"]) {
    assert.deepEqual(normalizeSettingsPatch({ idle_enabled: v }).patch, { idle_enabled: true }, `true spelling: ${JSON.stringify(v)}`);
  }
  for (const v of [false, "false", 0, "0"]) {
    assert.deepEqual(normalizeSettingsPatch({ idle_enabled: v }).patch, { idle_enabled: false }, `false spelling: ${JSON.stringify(v)}`);
  }
});

test("normalizeSettingsPatch refuses an ambiguous boolean instead of inverting it", () => {
  const { patch, ignored } = normalizeSettingsPatch({ mqtt_enabled: "yes" });
  assert.deepEqual(patch, {});
  assert.deepEqual(ignored, ["mqtt_enabled (not a boolean)"]);
});

test("normalizeSettingsPatch refuses garbage numerics instead of sending 0 or null", () => {
  assert.deepEqual(normalizeSettingsPatch({ mqtt_port: "default" }).ignored, ["mqtt_port (not a number)"]);
  assert.deepEqual(normalizeSettingsPatch({ mqtt_port: "" }).ignored, ["mqtt_port (not a number)"]);
  assert.deepEqual(normalizeSettingsPatch({ mqtt_every_secs: " " }).ignored, ["mqtt_every_secs (not a number)"]);
  assert.deepEqual(normalizeSettingsPatch({ mqtt_port: "default" }).patch, {});
});

test("normalizeSettingsPatch applies the good keys of a mixed patch and reports the bad", () => {
  const { patch, ignored } = normalizeSettingsPatch({ idle_after_secs: 300, mqtt_port: "abc", nonsense: true });
  assert.deepEqual(patch, { idle_after_secs: 300 });
  assert.deepEqual(ignored, ["mqtt_port (not a number)", "nonsense (unknown setting)"]);
});

test("normalizeSettingsPatch keeps idle_random and coerces it to boolean", () => {
  assert.deepEqual(normalizeSettingsPatch({ idle_random: false }).patch, { idle_random: false });
  assert.deepEqual(normalizeSettingsPatch({ idle_random: "true" }).patch, { idle_random: true });
});

test("normalizeSettingsPatch keeps the MQTT keys with correct types", () => {
  const { patch, ignored } = normalizeSettingsPatch({
    mqtt_enabled: "true", mqtt_host: "192.168.1.50", mqtt_port: "1883", mqtt_every_secs: "3",
  });
  assert.deepEqual(patch, { mqtt_enabled: true, mqtt_host: "192.168.1.50", mqtt_port: 1883, mqtt_every_secs: 3 });
  assert.deepEqual(ignored, []);
});

test("every known key has exactly one coercion type", () => {
  for (const key of KNOWN_SETTING_KEYS) {
    assert.ok(!(NUMERIC_KEYS.has(key) && BOOLEAN_KEYS.has(key)), `${key} is both numeric and boolean`);
  }
  for (const key of [...NUMERIC_KEYS, ...BOOLEAN_KEYS]) {
    assert.ok((KNOWN_SETTING_KEYS as readonly string[]).includes(key), `${key} typed but not whitelisted`);
  }
});

test("KNOWN_SETTING_KEYS contains idle_after_secs and timezone", () => {
  assert.ok(KNOWN_SETTING_KEYS.includes("idle_after_secs"), "expected idle_after_secs");
  assert.ok(KNOWN_SETTING_KEYS.includes("timezone"), "expected timezone");
});
