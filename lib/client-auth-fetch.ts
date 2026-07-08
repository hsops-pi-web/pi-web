// 统一 fetch 包装：任意响应 401 → 跳登录页。用于所有需要登录态的前端请求。
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  return res;
}
