export function isResearchRequest(value) {
  const text = String(value || '').trim();
  if (/^(?:(?:hey\s+)?friday[, :]+)?(?:please\s+)?(?:investigate|research|deep research)\b/i.test(text)) return true;
  if (/\b(?:conduct|perform|do|carry out|help me with)\s+(?:a\s+|an\s+|some\s+)?(?:research|investigation|r\s*&\s*d)\b/i.test(text)) return true;
  const signals = [
    /\b(?:research|r\s*&\s*d|academic sources|credible sources|supporting citations|cite sources)\b/i,
    /\b(?:hypothes[ie]s|verified facts|evidence quality|independent critic|challenge conclusions)\b/i,
    /\b(?:engineering improvements|simulation|simulations|experiments|publicly documented designs)\b/i,
    /\b(?:compare|analy[sz]e|investigate|propose|evaluate|recommend|rank)\b/i,
  ].filter(pattern => pattern.test(text)).length;
  return signals >= 2;
}

export function isTimeRequest(value) {
  const text = String(value || '').trim().replace(/^(?:hey\s+)?friday[\s,:]+/i, '').replace(/^please\s+/i, '').replace(/[?.!]+$/, '').trim();
  return /^(?:time|date|day|current (?:local )?(?:time|date)|what(?:'s| is) (?:the )?(?:current |local )?(?:time|date)(?: (?:now|today))?|what (?:time|day|date) is (?:it|today)|what day of (?:the )?week is (?:it|today)|(?:tell|show|give) me (?:the )?(?:current |local )?(?:time|date))$/i.test(text);
}
