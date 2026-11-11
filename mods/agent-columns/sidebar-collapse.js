import { layout, run, shared, setShared } from "herdr";

/** @param {any} tree @param {string} id @returns {any} */
const find = (tree, id) => tree?.id === id ? tree : (tree?.children ?? []).map((/** @type {any} */ child) => find(child, id)).find(Boolean);
/** @param {string} id */
export const blockCollapsed = id => find(layout(), id)?.max === 38;

/** @param {string} id */
export function toggleBlock(id) {
  const tree = JSON.parse(JSON.stringify(layout()));
  const block = find(tree, id);
  if (!block) return;
  const key = `sidebar-block-size.${shared("layout")}.${id}`;
  if (block.max === 38) {
    const saved = shared(key) ?? { size: { weight: id === "spaces" ? 1 : 2 }, min: id === "spaces" ? 130 : 220 };
    delete block.size;
    delete block.min;
    delete block.max;
    Object.assign(block, saved);
  } else {
    setShared(key, { size: block.size, min: block.min, max: block.max });
    block.size = { px: 38 };
    block.min = 38;
    block.max = 38;
  }
  run("layout.set", { layout: tree });
}
