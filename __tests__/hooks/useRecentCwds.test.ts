import { describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRecentCwds } from "@/hooks/useRecentCwds";
import { getAll, add, remove, clear } from "@/lib/recent-cwds-storage";

jest.mock("@/lib/recent-cwds-storage");

const mockGetAll = getAll as jest.MockedFunction<typeof getAll>;
const mockAdd = add as jest.MockedFunction<typeof add>;
const mockRemove = remove as jest.MockedFunction<typeof remove>;
const mockClear = clear as jest.MockedFunction<typeof clear>;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAll.mockReturnValue([]);
  mockAdd.mockReturnValue([]);
  mockRemove.mockReturnValue([]);
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
