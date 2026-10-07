// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/client";
import { EVENT_HEADER } from "@/lib/events/route";

vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  type Options = Omit<NonNullable<Parameters<typeof actual.createBrowserClient>[2]>, "cookies">;
  return {
    ...actual,
    createBrowserClient: vi.fn(
      (url: string, key: string, options?: Options) =>
        actual.createBrowserClient(url, key, {
          ...options,
          auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
        })
    ),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("같은 browser client가 행사 전환과 행사 없는 경로의 요청 범위를 따른다", async () => {
  const firstEvent = "18650503-b0fa-4d8e-ab16-72eb47c8c384";
  const secondEvent = "28650503-b0fa-4d8e-ab16-72eb47c8c384";
  const requests: Headers[] = [];
  const mockFetch = vi.fn<typeof fetch>(async (_input, init) => {
    requests.push(new Headers(init?.headers));
    return new Response("[]", { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");

  window.history.replaceState({}, "", `/admin/e/${firstEvent}/buses`);
  const first = createClient();
  await first.from("registrations").select("id");
  window.history.replaceState({}, "", `/admin/e/${secondEvent}/buses`);
  const second = createClient();
  expect(second).toBe(first);
  await second.from("registrations").select("id");
  window.history.replaceState({}, "", "/campus");
  await second.from("registrations").select("id");
  window.history.replaceState({}, "", `/admin/e/${firstEvent}/buses`);
  await second.from("registrations").select("id");

  expect(requests.map((headers) => headers.get(EVENT_HEADER))).toEqual([
    firstEvent, secondEvent, null, firstEvent,
  ]);
  expect(requests.every((headers) => headers.get("authorization") === "Bearer synthetic-anon-key")).toBe(true);

  const scopedFetch = vi.mocked(createBrowserClient).mock.calls[0][2]?.global?.fetch;
  expect(scopedFetch).toBeTypeOf("function");
  if (!scopedFetch) throw new Error("요청별 행사 fetch가 없습니다");
  await scopedFetch(new Request("http://127.0.0.1:54321/rest/v1/registrations", {
    headers: { "x-request-header": "kept", [EVENT_HEADER]: secondEvent },
  }), { headers: { "x-init-header": "kept", authorization: "Bearer synthetic-token" } });
  const last = requests.at(-1);
  expect(last?.get("x-request-header")).toBe("kept");
  expect(last?.get("x-init-header")).toBe("kept");
  expect(last?.get("authorization")).toBe("Bearer synthetic-token");
  expect(last?.get(EVENT_HEADER)).toBe(firstEvent);
});
