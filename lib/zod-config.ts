/**
 * zod probes for eval (new Function) to speed up parsing; the app's CSP
 * forbids eval, so the probe only produced a console CSP violation before
 * zod fell back. Turn the probe off. Imported for its side effect.
 */
import { z } from "zod";

z.config({ jitless: true });
