export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
export const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export function isValidUsername(name: string): boolean {
  return typeof name === "string" && USERNAME_RE.test(name);
}

export function isValidPassword(pw: string): boolean {
  return typeof pw === "string" && PASSWORD_RE.test(pw);
}

// 注册关键词门禁：与配置的 REGISTER_KEYWORD 比较，默认值只在此处保留一份。
export function isValidRegisterKeyword(keyword: unknown): boolean {
  const expected = process.env.REGISTER_KEYWORD ?? "tsingmao";
  return keyword === expected;
}
