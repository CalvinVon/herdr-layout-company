import { layout, run, shared, setShared } from "herdr";

/** @param {any} tree @param {string} id @returns {any} */
const find = (tree, id) => tree?.id === id ? tree : (tree?.children ?? []).map((/** @type {any} */ child) => find(child, id)).find(Boolean);
/** @param {string} id */
const collapsedKey = id => `sidebar-block-collapsed.${shared("layout")}.${id}`;
/** @param {string} id */
export const blockCollapsed = id => shared(collapsedKey(id)) === true;

/** @param {string} id */
export function toggleBlock(id) {
  const block = find(layout(), id);
  if (!block) return;
  const key = `sidebar-block-size.${shared("layout")}.${id}`;
  if (blockCollapsed(id)) {
    const size = shared(key)?.size ?? { weight: id === "spaces" ? 1 : 2 };
    setShared(collapsedKey(id), false);
    run("layout.resize", { id, ...size });
  } else {
    setShared(key, { size: block.size });
    setShared(collapsedKey(id), true);
    run("layout.resize", { id, px: id === "agents" ? 40 : 38 });
  }
}
