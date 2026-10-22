const ALLOWED = new Set(['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']);

export function parsePreflightSettings(text) {
  if (typeof text !== 'string') throw new Error('Invalid preflight settings');
  const settings = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Invalid preflight setting');
    const name = line.slice(0, separator).trim();
    if (!ALLOWED.has(name)) throw new Error('Unknown preflight setting');
    if (Object.hasOwn(settings, name)) throw new Error('Duplicate preflight setting');
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && ['"', "'"].includes(value[0]) && value.at(-1) === value[0])
      value = value.slice(1, -1);
    if (!value) throw new Error(`Missing ${name}`);
    settings[name] = value;
  }
  for (const name of ALLOWED) if (!settings[name]) throw new Error(`Missing ${name}`);
  const port = Number(settings.PGPORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PGPORT');
  return { host: settings.PGHOST, port, database: settings.PGDATABASE,
    user: settings.PGUSER, password: settings.PGPASSWORD };
}
