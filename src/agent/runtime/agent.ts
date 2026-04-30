/**
 * Web Agent runtime entrypoint.
 * Dynamic `import("./bootstrap.js")` ensures bootstrap load failures reject the same promise
 * as `main()`, so this handler runs instead of an unhandled exception (exit 1 with no context).
 * Do not add unrelated static imports here — they evaluate before this chain.
 */

void import("./bootstrap.js")
  .then((m) => m.main())
  .catch((e) => {
    try {
      const errPayload = {
        errName: e && typeof e === "object" && "name" in e ? String((e as Error).name) : "Error",
        errMessage: String(
          e && typeof e === "object" && "message" in e && (e as Error).message != null
            ? (e as Error).message
            : e
        ),
        errStack:
          typeof e === "object" && e && typeof (e as Error).stack === "string"
            ? (e as Error).stack!.slice(0, 4000)
            : undefined,
      };
      try {
        process.stdout.write(
          `<<<WEBAGENT_FATAL_ERROR>>>${JSON.stringify(errPayload)}<<<END_WEBAGENT_FATAL_ERROR>>>\n`
        );
      } catch {
        /* ignore */
      }
      console.error(e);
    } catch (handlerErr) {
      console.error(handlerErr);
      console.error(e);
    }
    process.exit(1);
  });
