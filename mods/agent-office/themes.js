import { div } from "gpui-kit";
import * as A from "./art.js";

const themes = {
  dispatch: { kind: "dispatch", name: "Charging dispatch", wall: "#c9e2e9", floor: "#697c84", trim: "#344950", accent: "#b5eb55", text: "#effff5", banner: "#29454d", deskTop: "#b9d4d8", deskEdge: "#526d75" },
  workshop: { kind: "workshop", name: "Workshop", wall: "#b9bdd9", floor: "#727783", trim: "#343b60", accent: "#f39a47", text: "#fff7e8", banner: "#34375f", deskTop: "#aeb7c1", deskEdge: "#59616d" },
  loft: { kind: "loft", name: "Loft library", wall: "#f0e4ce", floor: "#b88c64", trim: "#76553d", accent: "#829e78", text: "#fff9e9", banner: "#536d52", deskTop: "#b78050", deskEdge: "#765038" },
};

/** @type {Record<string, {furniture: (keyof typeof furnitureWidths)[], wall: number[], stagger: number}>} */
const layouts = {
  dispatch: { furniture: ["zoneX", "coolerX", "couchX"], wall: [1, 5, 4, 2, 3], stagger: 0 },
  workshop: { furniture: ["coolerX", "zoneX", "couchX"], wall: [2, 4, 5, 3, 1], stagger: 6 },
  loft: { furniture: ["couchX", "coolerX", "zoneX"], wall: [3, 2, 4, 1, 5], stagger: 3 },
};
const furnitureWidths = { zoneX: A.COUNTER.width, coolerX: A.COOLER.width, couchX: A.COUCH.width };
/** @param {{id?: string, name?: string}} project */
const roomHash = project => {
  let hash = 0;
  for (const c of String(project.id ?? project.name ?? "")) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
  return hash;
};

export function themeFor(project) {
  const name = `${project.name ?? ""} ${project.folder ?? ""}`.toLowerCase();
  if (name.includes("compound-powers")) return themes.workshop;
  if (name.includes("epower")) return themes.dispatch;
  if (name.includes("mythos")) return themes.loft;
  return [themes.dispatch, themes.workshop, themes.loft][roomHash(project) % 3];
}

export function officeGeometry(W, H, count, project) {
  const P = Math.max(1, Math.min(4, Math.floor(H / 80)));
  const kind = themeFor(project).kind;
  const layout = layouts[kind];
  const variant = roomHash(project) % layout.wall.length;
  const floorY = H - 12 * P;
  const wallBottom = floorY - 14 * P;
  const slot = A.SLOT * P;
  const columns = Math.max(0, count);
  const gap = kind === "workshop" ? 8 * P : kind === "loft" ? 4 * P : 0;
  const deskWidth = columns * slot + Math.max(0, Math.floor((columns - 1) / 2)) * gap;
  const doorX = 8 * P;
  const plantL = doorX + 20 * P;
  const x0 = plantL + (A.PLANT.width + 8) * P;
  let edge = x0 + deskWidth + 12 * P;
  /** @type {Record<string, number>} */
  const positions = {};
  for (const key of layout.furniture) {
    positions[key] = edge;
    edge += (furnitureWidths[key] + 16) * P;
  }
  const { zoneX, coolerX, couchX } = positions;
  const plantR = edge - 10 * P;
  const wallHeight = Math.max(40, Math.min(110, wallBottom - 52));
  const fixtureScale = Math.max(1, Math.min(P, Math.floor(wallHeight / 25)));
  const wallLeft = doorX + 16 * P + 16;
  const wallWidth = 120 + 96 + 84 + 70 + 30 * fixtureScale + 150 + 158 + 6 * 12;
  const contentWidth = Math.max(W, plantR + (A.PLANT.width + 8) * P, wallLeft + wallWidth + 8);
  const deskPos = (i) => ({ x: x0 + i * slot + Math.floor(i / 2) * gap, y: floorY });
  const wallOrder = [0, ...layout.wall.map((_, i) => layout.wall[(i + variant) % layout.wall.length]), 6];
  return { P, floorY, wallBottom, slot, x0, deskPos, zoneX, coolerX, couchX, doorX, plantL, plantR, door: { x: doorX + 2 * P, y: wallBottom + 2 * P }, contentWidth, wallHeight, fixtureScale, wallLeft, wallWidth, wallOrder, wallStagger: layout.stagger };
}

export function roomBackdrop(W, H, g, project, sky, weather) {
  const t = themeFor(project);
  const P = g.P;
  const width = Math.max(W, g.contentWidth ?? W);
  const out = [];
  const rect = (x, y, w, h, color) => {
    if (w > 0 && h > 0) out.push(div().absolute().left(x).top(y).w(w).h(h).bg(color));
  };
  rect(0, 0, width, g.wallBottom, t.wall);
  if (t.kind === "dispatch") {
    rect(0, g.wallBottom - 16 * P, width, 16 * P, t.deskTop);
    for (let x = 0; x < width; x += 48 * P) rect(x, g.wallBottom - 16 * P, P, 16 * P, t.floor);
  } else if (t.kind === "workshop") {
    for (let x = 16 * P; x < width; x += 52 * P) rect(x, 0, P, g.wallBottom, t.deskTop);
    rect(0, g.wallBottom - 12 * P, width, 2 * P, t.trim);
  } else {
    rect(0, g.wallBottom - 18 * P, width, 18 * P, t.deskEdge);
    rect(0, g.wallBottom - 18 * P, width, 2 * P, t.deskTop);
    for (let x = 8 * P; x < width; x += 32 * P) rect(x, g.wallBottom - 16 * P, P, 16 * P, t.deskTop);
  }
  rect(0, g.wallBottom - 4 * P, width, 4 * P, t.trim);
  rect(0, g.wallBottom, width, H - g.wallBottom, t.floor);
  for (let y = g.wallBottom + 12 * P; y < H; y += 12 * P) rect(0, y, width, P, t.trim);
  const bannerW = Math.min(width - 20, Math.max(180, Math.min(480, String(project.name ?? "").length * 9 + 24)));
  const bannerX = Math.max(10, (width - bannerW) / 2);
  const top = 8;
  out.push(div().id("project-banner").absolute().left(bannerX).top(top).w(bannerW).h(26).bg(t.banner).text_color(t.text).text_size(14).font_semibold().flex().items_center().justify_center().overflow_hidden().child(String(project.name ?? "")));
  return out;
}

export function roomFixture(project, P) {
  const t = themeFor(project), out = [], px = 0, py = 0;
  const rect = (x, y, w, h, color) => out.push(div().absolute().left(x).top(y).w(w).h(h).bg(color));
  if (t.kind === "dispatch") {
    rect(px, py, 30 * P, 20 * P, t.trim);
    rect(px + 2 * P, py + 2 * P, 26 * P, 16 * P, "#426c79");
    for (let i = 0; i < 4; i++) { rect(px + (4 + i * 6) * P, py + 5 * P, 3 * P, 6 * P, t.accent); rect(px + (4 + i * 6) * P, py + 13 * P, 3 * P, P, "#e1f8fb"); }
  } else if (t.kind === "workshop") {
    rect(px, py, 30 * P, 22 * P, t.trim);
    rect(px + 2 * P, py + 2 * P, 26 * P, 18 * P, "#7e8998");
    for (let i = 0; i < 4; i++) { rect(px + (5 + i * 6) * P, py + 5 * P, P, 10 * P, t.accent); rect(px + (4 + i * 6) * P, py + 4 * P, 3 * P, 2 * P, t.accent); }
    rect(px + 2 * P, py + 17 * P, 26 * P, P, t.trim);
  } else {
    rect(px, py, 30 * P, 25 * P, t.trim);
    rect(px + 2 * P, py + 2 * P, 26 * P, 21 * P, "#c59b6c");
    for (let row = 0; row < 2; row++) {
      rect(px + 2 * P, py + (11 + row * 10) * P, 26 * P, P, t.trim);
      for (let i = 0; i < 6; i++) rect(px + (3 + i * 4) * P, py + (4 + row * 10) * P, 3 * P, 7 * P, ["#819b78", "#b66952", "#d7c18a"][i % 3]);
    }
  }
  return div().relative().w(30 * P).h(25 * P).children(out);
}
