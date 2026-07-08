const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export function isValidUsername(name: string): boolean {
  return typeof name === "string" && USERNAME_RE.test(name);
}

export function isValidPassword(pw: string): boolean {
  return typeof pw === "string" && PASSWORD_RE.test(pw);
}
