import { useState } from "react";

export function useDraftMessage() {
  const [draft, setDraft] = useState("");
  return {
    draft,
    resetDraft() {
      setDraft("");
    },
    setDraft,
  };
}
