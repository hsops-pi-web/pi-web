// 统一 fetch 包装：任意响应 401 → 跳登录页。用于所有需要登录态的前端请求。
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  return res;
}

// 轻量探活：命中 401 跳登录并返回 true，否则返回 false。
// 用于 SSE onerror 等场景——需要判断“是否因掉登录态而断开”，但不消费响应体。
export async function redirectIfUnauthorized(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/me");
    if (res.status === 401) {
      window.location.href = "/login";
      return true;
    }
  } catch {
    // 网络错误按“未掉登录态”处理，交由调用方走各自的重连逻辑。
  }
  return false;
}
