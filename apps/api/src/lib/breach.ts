import { createHash } from "node:crypto";

export interface BreachChecker {
  /** True when the password is known to appear in public breach data. */
  isBreached(password: string): Promise<boolean>;
}

export class NoopBreachChecker implements BreachChecker {
  async isBreached(): Promise<boolean> {
    return false;
  }
}

/**
 * Have I Been Pwned range API (k-anonymity): only the first 5 hex chars of the password's SHA-1
 * leave the server, never the password or full hash. If the service is slow or down the check
 * fails open (signup keeps working) and the failure is reported through `onError`.
 */
export class HibpBreachChecker implements BreachChecker {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly onError: (err: unknown) => void = () => undefined,
    private readonly timeoutMs = 3000,
    private readonly baseUrl = "https://api.pwnedpasswords.com/range/",
  ) {}

  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await this.fetchFn(this.baseUrl + prefix, {
        headers: { "Add-Padding": "true", "User-Agent": "PrepQuest-password-check" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`HIBP responded ${res.status}`);
      for (const line of (await res.text()).split("\n")) {
        const [hashSuffix, count] = line.trim().split(":");
        // padded entries have a count of 0
        if (hashSuffix === suffix && Number(count) > 0) return true;
      }
      return false;
    } catch (err) {
      this.onError(err);
      return false;
    }
  }
}
