import { createContext, useContext } from "react";

/** The sidebar's account filter, shown as a clearable chip in page headers. */
export const AccountFilter = createContext<{ name: string | null; clear: () => void }>({ name: null, clear: () => {} });
export const useAccountFilter = () => useContext(AccountFilter);
