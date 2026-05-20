import { expect, test } from "@playwright/test";

/**
 * Phase A 게이트 1: 홈 페이지가 렌더링되고 두 로그인 진입점이 보임.
 */
test("홈 페이지 렌더 + 로그인 버튼 2개", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /71기 광주지구 여름수련회/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Google로 로그인/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /운영자 로그인/ })).toBeVisible();
});

test("/login 페이지 Google 버튼 표시", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /임역원 로그인/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Google로 로그인/ })).toBeVisible();
});

test("/admin/login 페이지 비밀번호 입력 폼 표시", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: /운영자 로그인/ })).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
});

test("미인증 사용자 /campus 접근 시 /login 리다이렉트", async ({ page }) => {
  await page.goto("/campus");
  await expect(page).toHaveURL(/\/login/);
});

test("미인증 사용자 /admin 접근 시 /admin/login 리다이렉트", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
});
