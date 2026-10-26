import { runBinaryHelper } from "./mac-binary-replacement.js";

process.on("uncaughtException", () => process.exit(1));
process.on("unhandledRejection", () => process.exit(1));
void runBinaryHelper().then(() => process.exit(0), () => process.exit(1));
