import { beforeAll, describe, expect, it } from "vitest";
import { getAuthorizationUrl } from "@/lib/meta/oauth";

beforeAll(() => {
  process.env.INSTAGRAM_APP_ID = "123";
});

describe("Instagram authorization URL", () => {
  it("uses the documented www.instagram.com endpoint", () => {
    const url = new URL(getAuthorizationUrl("https://app.test/api/instagram/callback", "s"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.has("force_reauth")).toBe(false);
  });

  it("asks for a fresh login when another account is being added", () => {
    const url = new URL(
      getAuthorizationUrl("https://app.test/api/instagram/callback", "s", { forceReauth: true })
    );
    expect(url.searchParams.get("force_reauth")).toBe("true");
  });
});
