import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAll, add, remove, clear, validate } from "@/lib/recent-cwds-storage";

const STORAGE_KEY = "pi-web-recent-cwds";
const fetchMock = vi.fn<typeof fetch>();

vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
});
afterEach(() => localStorage.clear());

function setMockData(data: Array<{ path: unknown; timestamp: unknown }>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

describe("getAll", () => {
  it("应该返回空数组当 localStorage 为空", () => {
    expect(getAll()).toEqual([]);
  });

  it("应该正确解析有效的 JSON 数据", () => {
    const mockData = [
      { path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
    ];
    setMockData(mockData);
    expect(getAll()).toEqual(mockData);
  });

  it("应该按时间戳降序排序", () => {
    const mockData = [
      { path: "/p1", timestamp: "2026-06-30T11:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T12:00:00.000Z" },
    ];
    setMockData(mockData);
    const result = getAll();
    expect(result[0].path).toBe("/p2");
    expect(result[1].path).toBe("/p1");
  });

  it("损坏的 JSON 数据应该返回空数组", () => {
    localStorage.setItem(STORAGE_KEY, "invalid");
    expect(getAll()).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("应该过滤无效的数据项", () => {
    const mockData = [
      { path: "/valid", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: 123, timestamp: "2026-06-30T11:00:00.000Z" },
    ];
    setMockData(mockData);
    const result = getAll();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/valid");
  });
});

describe("add", () => {
  it("应该添加新目录到开头", () => {
    setMockData([{ path: "/existing", timestamp: "2026-06-30T12:00:00.000Z" }]);
    const result = add("/new");
    expect(result[0].path).toBe("/new");
    expect(result[1].path).toBe("/existing");
  });

  it("应该限制最多保存 5 个目录", () => {
    setMockData([
      { path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
      { path: "/p3", timestamp: "2026-06-30T10:00:00.000Z" },
      { path: "/p4", timestamp: "2026-06-30T09:00:00.000Z" },
      { path: "/p5", timestamp: "2026-06-30T08:00:00.000Z" },
    ]);
    const result = add("/new");
    expect(result).toHaveLength(5);
    expect(result[0].path).toBe("/new");
    expect(result[4].path).toBe("/p4");
  });

  it("添加已存在的目录时应该移到开头", () => {
    setMockData([
      { path: "/p1", timestamp: "2026-06-30T10:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
    ]);
    const result = add("/p2");
    expect(result[0].path).toBe("/p2");
    expect(result[0].timestamp).not.toBe("2026-06-30T11:00:00.000Z");
  });
});

describe("remove", () => {
  it("应该删除指定的目录", () => {
    setMockData([
      { path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
    ]);
    const result = remove("/p2");
    expect(result).toHaveLength(1);
    expect(result.find((i) => i.path === "/p2")).toBeUndefined();
  });

  it("删除最后一个目录时应该清空存储", () => {
    setMockData([{ path: "/only", timestamp: "2026-06-30T12:00:00.000Z" }]);
    const result = remove("/only");
    expect(result).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("clear", () => {
  it("应该清空所有历史记录", () => {
    setMockData([{ path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" }]);
    clear();
    expect(getAll()).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("validate", () => {
  it("验证有效目录应该返回 true", async () => {
    fetchMock.mockResolvedValue(Response.json({ cwd: "/valid" }));
    expect(await validate("/valid")).toBe(true);
  });

  it("验证无效目录应该返回 false", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    expect(await validate("/invalid")).toBe(false);
  });

  it("网络错误应该返回 undefined", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));
    expect(await validate("/path")).toBeUndefined();
  });
});
