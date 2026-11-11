/** @typedef {{hash: string, parents: string[], short: string, author: string, date: string, subject: string, refs: string}} Commit */
/** @typedef {{from: number, to: number, color: number, middle: boolean}} Edge */
/** @typedef {Commit & {slot: number, color: number, incoming: boolean, edges: Edge[], width: number}} GraphRow */

/** @param {string} text @returns {Commit[]} */
export function parseLog(text) {
  return text.split("\x1e").filter(record => record.trim()).map(record => {
    const fields = record.replace(/^\r?\n/, "").split("\0");
    if (fields.length !== 7 || !/^[a-f0-9]{40,64}$/.test(fields[0])) throw new Error("Cannot parse Git history");
    const [hash, parents, short, author, date, subject, refs] = fields;
    return { hash, parents: parents.split(" ").filter(Boolean), short, author, date, subject, refs };
  });
}

/** @param {Commit[]} commits @returns {GraphRow[]} */
export function graphRows(commits) {
  /** @type {{hash: string, color: number}[]} */
  let lanes = [];
  let nextColor = 0;
  return commits.map(commit => {
    let slot = lanes.findIndex(lane => lane.hash === commit.hash);
    const incoming = slot >= 0;
    if (slot < 0) { slot = lanes.length; lanes.push({ hash: commit.hash, color: nextColor++ }); }
    const before = lanes.slice(), color = before[slot].color;
    lanes = before.filter((_, index) => index !== slot);
    let insert = Math.min(slot, lanes.length);
    for (const [index, hash] of commit.parents.entries()) {
      if (!lanes.some(lane => lane.hash === hash)) lanes.splice(insert++, 0, { hash, color: index === 0 ? color : nextColor++ });
    }
    /** @type {Edge[]} */
    const edges = [];
    before.forEach((lane, from) => {
      if (from === slot) {
        for (const hash of commit.parents) {
          const to = lanes.findIndex(next => next.hash === hash);
          edges.push({ from, to, color: lanes[to].color, middle: true });
        }
      } else edges.push({ from, to: lanes.findIndex(next => next.hash === lane.hash), color: lane.color, middle: false });
    });
    return { ...commit, slot, color, incoming, edges, width: Math.max(before.length, lanes.length) * 16 + 16 };
  });
}
