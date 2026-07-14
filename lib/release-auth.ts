import { timingSafeEqual } from "node:crypto";

type ReleaseEnv = NodeJS.ProcessEnv;

export function isAuthorizedReleaseRequest(
  request: Request,
  env: ReleaseEnv = process.env,
): boolean {
  const expected = env.PI_WEB_RELEASE_TOKEN;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  if (expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}
