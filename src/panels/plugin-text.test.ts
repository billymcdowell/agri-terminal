import { describe, expect, it } from "vitest";
import { permissionLines } from "./plugin-text";

describe("permissionLines", () => {
  it("lists hosts, secrets, cadence and series", () => {
    const lines = permissionLines({ hosts: ["a.example.com", "*.b.org"], secrets: [{ name: "token", configured: false }], series: ["s1", "s2", "s3", "s4"], cadence: "daily" });
    expect(lines[0]).toBe("Connects to: a.example.com, *.b.org");
    expect(lines[1]).toBe("Uses keychain secrets: token");
    expect(lines[3]).toBe("Writes 4 series: s1, s2, s3, …");
    expect(lines[4]).toContain("Cannot run code");
  });
  it("says so when no secrets are used", () => {
    expect(permissionLines({ hosts: ["x.org"], secrets: [], series: ["s"], cadence: "weekly" })[1]).toBe("Uses no secrets");
  });
});
