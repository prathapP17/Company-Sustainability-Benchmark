import { appOrigin, type HeaderLike } from "../pipeline/access";

/**
 * The URL an admin passes on. The token is in the fragment (#…), which
 * browsers never send to the server, so it stays out of logs and Referer.
 */
export function passwordLinkUrl(token: string, headers?: HeaderLike): string {
  const origin = appOrigin()?.origin ?? headers?.get("origin") ?? "http://localhost:3000";
  return `${origin}/review/set-password#${token}`;
}
