import { describe, expect, it } from "vitest";
import { activeFilterCount, readParams, toggle, toQueryString } from "./list-params";

describe("list params", () => {
  it("round-trips filters through the query string, omitting defaults", () => {
    const sp = new URLSearchParams(
      "q=two+sum&topic=arrays,hashing&difficulty=easy&sort=acceptance&topicMode=all&sheet=foundations-20",
    );
    const params = readParams(sp);
    expect(params).toMatchObject({
      q: "two sum",
      topic: ["arrays", "hashing"],
      difficulty: ["easy"],
      sort: "acceptance",
      topicMode: "all",
      sheet: "foundations-20",
    });
    expect(new URLSearchParams(toQueryString(params)).toString()).toBe(
      new URLSearchParams(
        "q=two+sum&topic=arrays,hashing&difficulty=easy&sheet=foundations-20&topicMode=all&sort=acceptance",
      ).toString(),
    );
    expect(toQueryString(readParams(new URLSearchParams()))).toBe("");
  });

  it("ignores junk values", () => {
    const params = readParams(new URLSearchParams("sort=hacked&topicMode=sideways&topic=,,a,"));
    expect(params.sort).toBe("default");
    expect(params.topicMode).toBe("any");
    expect(params.topic).toEqual(["a"]);
  });

  it("counts active filters and toggles values", () => {
    expect(activeFilterCount(readParams(new URLSearchParams("topic=a,b&sheet=s&q=x")))).toBe(4);
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });
});
