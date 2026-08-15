import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * send-signup-otp — DISABLED for production.
 * App uses native supabase.auth.signInWithOtp instead.
 * Deploy with verify_jwt: true so anonymous callers cannot abuse this endpoint.
 */
Deno.serve(async (_req: Request) => {
  return new Response(
    JSON.stringify({
      error: "disabled",
      message: "Use native Auth email OTP. This Edge Function is retired.",
    }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        Connection: "keep-alive",
      },
    },
  );
});
