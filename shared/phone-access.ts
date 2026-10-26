export type PhoneAccessRecord = { origin: string; httpsPort: number; backendPort: number; phase: "pending" | "ready" };
export type PhoneAccessStatus = {
  supported: boolean;
  state: "off" | "ready" | "unavailable" | "needs-login" | "error";
  message: string;
  canManage: boolean;
  url?: string;
  hasRoute?: boolean;
};

export type PairedPhone = { id: string; name: string; createdAt: number };
export type PhonePairing = { id: string; expiresAt: number; phase: "waiting" | "claimed" | "approved" | "complete"; code?: string; qr?: string };
export type PhoneDevices = { devices: PairedPhone[]; pairing?: PhonePairing };
export type PhoneCredential = PairedPhone & { origin: string; publicKey: string; counter: number; userId: string; transports?: string[] };
