import type { ScannedWine } from "./gemini";

export type CapturedPage = {
  id: string;
  previewUrl: string | null;
  status: "uploading" | "done" | "error";
  wineCount: number;
  wines: ScannedWine[];
};

export type ScanState = {
  pages: CapturedPage[];
  phase: "capture" | "processing" | "verdict";
};

export type ScanAction =
  | { type: "ADD_PAGE"; page: CapturedPage }
  | { type: "UPDATE_PAGE"; id: string; patch: Partial<CapturedPage> }
  | { type: "REMOVE_PAGE"; id: string }
  | { type: "SET_PHASE"; phase: ScanState["phase"] }
  | { type: "RESET" };

export const initialState: ScanState = {
  pages: [],
  phase: "capture",
};

export function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "ADD_PAGE":
      return { ...state, pages: [...state.pages, action.page] };
    case "UPDATE_PAGE":
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === action.id ? { ...p, ...action.patch } : p
        ),
      };
    case "REMOVE_PAGE":
      return {
        ...state,
        pages: state.pages.filter((p) => p.id !== action.id),
      };
    case "SET_PHASE":
      return { ...state, phase: action.phase };
    case "RESET":
      return initialState;
  }
}
