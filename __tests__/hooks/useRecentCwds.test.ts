import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { useRecentCwds } from "@/hooks/useRecentCwds";
import { getAll, add, remove, clear, validate } from "@/lib/recent-cwds-storage";

vi.mock("@/lib/recent-cwds-storage");

afterEach(cleanup);

const mockGetAll = vi.mocked(getAll);
const mockAdd = vi.mocked(add);
const mockRemove = vi.mocked(remove);
const mockClear = vi.mocked(clear);
const mockValidate = vi.mocked(validate);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockReturnValue([]);
  mockAdd.mockReturnValue([]);
  mockRemove.mockReturnValue([]);
  mockValidate.mockResolvedValue(true);
});

describe("useRecentCwds", () => {
  it("应该初始加载历史目录", async () => {
    const mockData = [
      { path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
    ];
    mockGetAll.mockReturnValue(mockData);

    const { result } = renderHook(() => useRecentCwds());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cwds).toEqual(mockData);
  });

  it("addCwd 应该更新状态", () => {
    const { result } = renderHook(() => useRecentCwds());
    const newData = [{ path: "/new", timestamp: "2026-06-30T13:00:00.000Z" }];
    mockAdd.mockReturnValue(newData);

    act(() => {
      result.current.addCwd("/new");
    });

    expect(mockAdd).toHaveBeenCalledWith("/new");
    expect(result.current.cwds).toEqual(newData);
  });

  it("removeCwd 应该更新状态", () => {
    const { result } = renderHook(() => useRecentCwds());
    const remaining = [{ path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" }];
    mockRemove.mockReturnValue(remaining);

    act(() => {
      result.current.removeCwd("/p2");
    });

    expect(mockRemove).toHaveBeenCalledWith("/p2");
    expect(result.current.cwds).toEqual(remaining);
  });

  it("clearCwds 应该清空状态", () => {
    const { result } = renderHook(() => useRecentCwds());

    act(() => {
      result.current.clearCwds();
    });

    expect(mockClear).toHaveBeenCalled();
    expect(result.current.cwds).toEqual([]);
  });
});
