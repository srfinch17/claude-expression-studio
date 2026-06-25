#!/usr/bin/env python3
"""Parity test: the Python resolver must match shared/resolver-fixtures.json
exactly (the same file the JS resolver test asserts against), so the two
implementations cannot drift. Exit 0 = pass, 1 = mismatch."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "shared", "resolver-fixtures.json")

sys.path.insert(0, HERE)
from manifest_resolver import resolve  # noqa: E402


def seq(values):
    vals = values or [0]
    state = {"i": 0}
    def rng():
        v = vals[state["i"] % len(vals)]
        state["i"] += 1
        return v
    return rng


def main():
    data = json.load(open(FIX, encoding="utf-8"))
    failures = []
    for c in data["cases"]:
        manifest = data["manifests"][c["manifest"]]
        ctx = {"rng": seq(c.get("rngSeq")), "last": {}}
        got = resolve(manifest, {"harness": c.get("harness"), "renderer": c["renderer"],
                                 "moment": c.get("moment"), "intent": c.get("intent")}, ctx)
        if got != c["expect"]:
            failures.append(f'{c["name"]}: got {got!r} want {c["expect"]!r}')
    if failures:
        print("PARITY FAIL:")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print(f"parity OK ({len(data['cases'])} cases)")


if __name__ == "__main__":
    main()
