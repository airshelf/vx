import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { relativeTime, stateColor, table, outputJson } from "../src/format";

describe("relativeTime", () => {
  test("just now for timestamps < 60s ago", () => {
    expect(relativeTime(Date.now() - 30_000)).toBe("just now");
  });

  test("1m ago for 60s", () => {
    expect(relativeTime(Date.now() - 60_000)).toBe("1m ago");
  });

  test("59m ago for 59*60s", () => {
    expect(relativeTime(Date.now() - 59 * 60_000)).toBe("59m ago");
  });

  test("1h ago for 3600s", () => {
    expect(relativeTime(Date.now() - 3_600_000)).toBe("1h ago");
  });

  test("23h ago for 23*3600s", () => {
    expect(relativeTime(Date.now() - 23 * 3_600_000)).toBe("23h ago");
  });

  test("1d ago for 86400s", () => {
    expect(relativeTime(Date.now() - 86_400_000)).toBe("1d ago");
  });

  test("30d ago for 30*86400s", () => {
    expect(relativeTime(Date.now() - 30 * 86_400_000)).toBe("30d ago");
  });
});

describe("stateColor", () => {
  test("READY contains the state name", () => {
    expect(stateColor("READY")).toContain("READY");
  });

  test("ERROR contains the state name", () => {
    expect(stateColor("ERROR")).toContain("ERROR");
  });

  test("CANCELED contains the state name", () => {
    expect(stateColor("CANCELED")).toContain("CANCELED");
  });

  test("BUILDING contains the state name", () => {
    expect(stateColor("BUILDING")).toContain("BUILDING");
  });

  test("INITIALIZING contains the state name", () => {
    expect(stateColor("INITIALIZING")).toContain("INITIALIZING");
  });

  test("QUEUED contains the state name", () => {
    expect(stateColor("QUEUED")).toContain("QUEUED");
  });

  test("unknown state returns unchanged", () => {
    expect(stateColor("WHATEVER")).toBe("WHATEVER");
  });
});

describe("table", () => {
  let spy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spy.mockRestore();
  });

  test("prints header and data rows without separator", () => {
    spy = spyOn(console, "log").mockImplementation(() => {});

    table(["Name", "Age"], [["Alice", "30"], ["Bob", "25"]]);

    expect(spy).toHaveBeenCalledTimes(3); // header + 2 data rows (no separator)

    const calls = spy.mock.calls;

    // Header contains column names
    expect(calls[0][0]).toContain("Name");
    expect(calls[0][0]).toContain("Age");

    // Data rows
    expect(calls[1][0]).toContain("Alice");
    expect(calls[2][0]).toContain("Bob");
  });
});

describe("outputJson", () => {
  let spy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spy.mockRestore();
  });

  test("prints formatted JSON", () => {
    spy = spyOn(console, "log").mockImplementation(() => {});

    outputJson({ foo: "bar", num: 42 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      JSON.stringify({ foo: "bar", num: 42 }, null, 2)
    );
  });
});
