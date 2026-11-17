// Keys a lower layer may not change (design doc 6.4).
import type { Diagnostic } from "./check.js";

export interface LockedKey {
  /** Dotted config path, e.g. "intake.identity.google_login". */
  path: string;
  /** The only value allowed. */
  value: unknown;
  /** Why it is locked (Korean); goes into the V12 message. */
  reason: string;
}

/** One file's parsed data in the extends chain. */
export interface ConfigLayer {
  file: string;
  data: unknown;
}

const LOCKED: readonly LockedKey[] = [
  { path: "intake.identity.google_login", value: "required", reason: "본인 확인은 구글 서명 토큰으로만 합니다" },
  { path: "intake.identity.one_per_account", value: true, reason: "구글 계정 하나로 한 번만 신청해야 명단의 한 줄이 한 사람입니다" },
  { path: "reviewers.permission", value: "pull", reason: "멘토와 심사위원은 읽기 권한만 받습니다" },
];

/** The locked keys of design doc 6.4. */
export function lockedKeys(): LockedKey[] {
  return LOCKED.map((key) => ({ ...key }));
}

/** V12: every layer that sets a locked key to another value. Writing the locked value again is fine. */
export function checkLockedKeys(layers: readonly ConfigLayer[]): Diagnostic[] {
  const found: Diagnostic[] = [];
  for (const layer of layers) {
    for (const key of LOCKED) {
      const written = valueAt(layer.data, key.path.split("."));
      if (!written.present || written.value === key.value) continue;
      found.push({
        id: "V12",
        severity: "error",
        path: key.path,
        message: `${key.path}는 잠긴 값이라 ${JSON.stringify(key.value)}로만 둘 수 있습니다(이유: ${key.reason}). ${layer.file}에서 ${JSON.stringify(written.value)}로 바꾸려고 했습니다.`,
      });
    }
  }
  return found;
}

/** The value at `path` through own properties only, and whether the layer writes it at all. */
function valueAt(data: unknown, path: readonly string[]): { present: boolean; value?: unknown } {
  let node = data;
  for (const segment of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, segment)) return { present: false };
    node = (node as Record<string, unknown>)[segment];
  }
  return { present: true, value: node };
}
