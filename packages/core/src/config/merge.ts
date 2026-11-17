// Merge rules for config layers (design doc 6.3).

/** A layer used add/remove/update (or a keyed list) wrongly. `path` is the dotted config path. */
export class MergeError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

/** Path segment for an item of a keyed list, as `update` merges into it. */
const ITEM = "[]";

const DIRECTIVES = ["add", "remove", "update"];

/**
 * The field that identifies the items of the keyed list at `path` — "key" for scoring.criteria (and
 * the children of its items at any depth), intake.fields and intake.consents, "id" for
 * schedule.sessions — or null anywhere else.
 */
export function listKeyAt(path: readonly string[]): "key" | "id" | null {
  const dotted = path.join(".");
  if (dotted === "intake.fields" || dotted === "intake.consents") return "key";
  if (dotted === "schedule.sessions") return "id";
  return /^scoring\.criteria(?:\.\[\]\.children)*$/.test(dotted) ? "key" : null;
}

/**
 * Merges `over` onto `base`: null deletes, objects merge per key, keyed lists take a replacement
 * array or `{ add, remove, update }`, other arrays take a replacement or `{ append }`, everything
 * else is replaced. `path` is where the two values sit in the config (it decides which lists are
 * keyed). Neither input is modified. Throws MergeError for a misused directive.
 */
export function merge(base: unknown, over: unknown, path: readonly string[] = []): unknown {
  if (over === undefined) return structuredClone(base);
  if (over === null) return undefined;
  const keyField = listKeyAt(path);
  if (keyField) return mergeKeyedList(base, over, path, keyField);
  if (Array.isArray(over)) return structuredClone(over);
  if (isAppend(over) && (base === undefined || Array.isArray(base))) return [...((structuredClone(base) as unknown[] | undefined) ?? []), ...structuredClone(over.append)];
  if (!isPlainObject(over)) return over;

  const from = isPlainObject(base) ? base : {};
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(from)) setOwn(result, key, structuredClone(from[key]));
  for (const key of Object.keys(over)) {
    const value = merge(Object.hasOwn(from, key) ? from[key] : undefined, over[key], [...path, key]);
    if (value === undefined) delete result[key];
    else setOwn(result, key, value);
  }
  return result;
}

function mergeKeyedList(base: unknown, over: unknown, path: readonly string[], keyField: "key" | "id"): unknown[] {
  if (Array.isArray(over)) return structuredClone(over);
  const where = path.join(".").replaceAll(".[]", "[]");
  const fail = (message: string): never => {
    throw new MergeError(where, `${where}: ${message}`);
  };
  if (!isPlainObject(over)) return fail("목록이나 { add, remove, update }를 적어야 합니다.");
  const unknownKeys = Object.keys(over).filter((k) => !DIRECTIVES.includes(k));
  if (unknownKeys.length > 0) return fail(`add, remove, update만 쓸 수 있습니다(${unknownKeys.join(", ")}).`);
  if (base !== undefined && !Array.isArray(base)) return fail("위 층의 값이 목록이 아니라서 add, remove, update를 쓸 수 없습니다.");

  const keyOf = (item: unknown, directive: string): string => {
    const key = isPlainObject(item) ? item[keyField] : undefined;
    return typeof key === "string" ? key : fail(`${directive}의 항목마다 ${keyField}가 있어야 합니다.`);
  };
  const listOf = (directive: string): unknown[] => {
    const value = over[directive];
    return value === undefined ? [] : Array.isArray(value) ? value : fail(`${directive}에는 목록을 적어야 합니다.`);
  };

  const removed = listOf("remove").map((k) => (typeof k === "string" ? k : fail(`remove에는 ${keyField}의 목록을 적어야 합니다.`)));
  let items = ((structuredClone(base) as unknown[] | undefined) ?? []).filter((item) => !removed.includes(keyOf(item, "위 층")));
  for (const patch of listOf("update")) {
    const key = keyOf(patch, "update");
    const at = items.findIndex((item) => keyOf(item, "위 층") === key);
    if (at < 0) fail(`update한 ${keyField} "${key}"가 위 층에 없습니다.`);
    items = items.map((item, i) => (i === at ? merge(item, patch, [...path, ITEM]) : item));
  }
  for (const item of listOf("add")) {
    const key = keyOf(item, "add");
    if (items.some((x) => keyOf(x, "위 층") === key)) fail(`add한 ${keyField} "${key}"가 이미 있습니다. 바꾸려면 update를 쓰세요.`);
    items.push(structuredClone(item));
  }
  return items;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAppend(value: unknown): value is { append: unknown[] } {
  return isPlainObject(value) && Object.keys(value).length === 1 && Array.isArray(value.append);
}

/** Defines an own property, so a YAML key like "__proto__" stays plain data. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
