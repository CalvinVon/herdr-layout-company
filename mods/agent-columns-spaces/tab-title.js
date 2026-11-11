/** @param {string|null|undefined} value */
export const clean = value => (value ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// Automatic tab names follow the lead agent; explicit names stay unchanged.
/** @param {{id: string, name: string, named?: boolean}} tab @param {import('herdr').PaneInfo[]} all */
export function tabTitle(tab, all) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  const lead = mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
  const raw = (lead?.title ?? "").trim();
  const live = clean(raw);
  const telling = live && live !== lead?.program?.name && !/^[~/]|^[A-Za-z]:\\/.test(raw)
    && !live.includes("@") && live.toLowerCase() !== lead?.program?.key;
  return (tab.name === lead?.program?.name || !tab.named) && telling ? live : tab.name;
}
