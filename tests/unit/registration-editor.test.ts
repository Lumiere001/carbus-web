// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRegistrationEditor } from "@/components/registrations/use-registration-editor";

const { search } = vi.hoisted(() => ({ search: { value: "edit=own" } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
afterEach(cleanup);

const ROWS = [{ id: "own", campus_id: "a" }, { id: "other", campus_id: "a" }, { id: "foreign", campus_id: "b" }];

describe("useRegistrationEditor", () => {
  it("opens the requested scoped person, supports closing, and follows a new edit URL", () => {
    // Given
    search.value = "edit=own";
    const { result, rerender } = renderHook(() => useRegistrationEditor(ROWS, "a"));
    expect(result.current.drawerId).toBe("own");
    // When
    act(() => result.current.closeRegistration());
    // Then
    expect(result.current.drawerId).toBeNull();

    // Given / When: subsequent client navigation in the same mounted list
    search.value = "edit=other";
    rerender();
    // Then
    expect(result.current.drawerId).toBe("other");
  });

  it.each(["foreign", "unlisted"])("does not open %s outside the current campus rows", (id) => {
    // Given
    search.value = `edit=${id}`;
    // When
    const { result } = renderHook(() => useRegistrationEditor(ROWS, "a"));
    // Then
    expect(result.current.drawerId).toBeNull();
  });

  it("allows a row button to open another person in scope", () => {
    // Given
    search.value = "";
    const { result } = renderHook(() => useRegistrationEditor(ROWS, "a"));
    // When
    act(() => result.current.openRegistration("other"));
    // Then
    expect(result.current.drawerId).toBe("other");
  });
});
