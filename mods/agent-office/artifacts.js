function terminalProcessKey(terminal) {
  if (!terminal.pid && !terminal.foreground?.pid) return null;
  return JSON.stringify([terminal.pid ?? null, terminal.foreground?.pid ?? null]);
}

export function artifactOwner(card, project, records, verified) {
  if (card.kind !== "file" || project.machine || card.machine || card.origin && card.origin !== "local" || card.roomKey && card.roomKey !== project.projectKey) return null;
  for (const identity of [card.author, card.workstation]) {
    if (!identity || !Number.isSafeInteger(identity.createdMs) || typeof identity.terminal !== "string" || !identity.terminal || identity.terminal.includes("/")) continue;
    if (identity === card.workstation && identity.space !== project.id) continue;
    const member = project.members?.find(member => member.terminal === identity.terminal);
    const terminal = records.find(record => record.address === identity.terminal && record.state === "live");
    if (!member || !terminal) continue;
    const proof = verified?.get(identity.terminal);
    let createdMs = terminal.created_ms;
    if (!Number.isSafeInteger(createdMs) && proof?.processKey && proof.processKey === terminalProcessKey(terminal)) createdMs = proof.createdMs;
    if (createdMs === identity.createdMs) return identity.terminal;
  }
  return null;
}

export async function verifyArtifactOwners(cards, records, inspect) {
  const identities = new Set(cards.filter(card => card.kind === "file").flatMap(card => [card.author?.terminal, card.workstation?.terminal]).filter(address => typeof address === "string" && address && !address.includes("/")));
  const verified = new Map();
  await Promise.all([...identities].map(async address => {
    const terminal = records.find(record => record.address === address && record.state === "live");
    if (!terminal || Number.isSafeInteger(terminal.created_ms)) return;
    const processKey = terminalProcessKey(terminal);
    if (!processKey) return;
    try {
      const info = await inspect(address);
      if (info?.state === "live" && Number.isSafeInteger(info.created_ms) && (!info.address || info.address === address)) verified.set(address, { createdMs: info.created_ms, processKey });
    } catch {}
  }));
  return verified;
}
