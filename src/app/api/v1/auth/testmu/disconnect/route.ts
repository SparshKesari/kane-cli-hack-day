import { envelopeResponse } from "@/server/core";
import { disconnect } from "@/server/testmu";

// POST /api/v1/auth/testmu/disconnect   forget this browser's TestMu AI connection (hd_testmu).
// The registration and its sign-in session are left alone.

export async function POST() {
  return envelopeResponse(async () => {
    await disconnect();
    return { message: "Disconnected from TestMu AI on this browser." };
  });
}
