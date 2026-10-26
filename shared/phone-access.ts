export type PhoneAccessRecord = { origin: string; httpsPort: number; backendPort: number; phase: "pending" | "ready" };
export type PhoneAccessStatus = {
  supported: boolean;
  state: "off" | "ready" | "unavailable" | "needs-login" | "error";
  message: string;
  canManage: boolean;
  url?: string;
  hasRoute?: boolean;
};
