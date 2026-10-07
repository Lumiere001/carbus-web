"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

export function useServerRows<T>(initialRows: T[], reconcile?: (incoming: T[], current: T[]) => T[]): readonly [T[], Dispatch<SetStateAction<T[]>>] {
  const [state, setState] = useState({ source: initialRows, rows: initialRows });
  const changed = state.source !== initialRows;
  const rows = changed ? (reconcile ? reconcile(initialRows, state.rows) : initialRows) : state.rows;
  if (changed) setState({ source: initialRows, rows });
  const setRows = useCallback<Dispatch<SetStateAction<T[]>>>((update) => {
    setState((current) => ({ ...current, rows: typeof update === "function" ? update(current.rows) : update }));
  }, []);
  return [rows, setRows];
}
