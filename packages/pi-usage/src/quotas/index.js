import { discoverQuotaProducts, fetchQuotaProducts } from './registry.js';

function fail(message) {
  throw new Error(message);
}

function parseFetchArguments(args) {
  const products = [];
  let offline = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') continue;
    if (argument === '--offline') {
      offline = true;
      continue;
    }
    if (argument !== '--product') fail(`Unknown quota fetch option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) fail('Option --product requires a value.');
    products.push(value);
    index += 1;
  }
  if (!products.length) fail('quota fetch requires at least one --product.');
  return { products, offline };
}

export async function runQuota(args, {
  environment = process.env,
  home,
  platform,
  log = message => console.log(message),
} = {}) {
  const subcommand = args[0];
  if (subcommand === 'discover') {
    const unknown = args.slice(1).filter(argument => argument !== '--json' && argument !== '--offline');
    if (unknown.length) fail(`Unknown quota discover option: ${unknown[0]}`);
    log(JSON.stringify(discoverQuotaProducts({ environment, home, platform })));
    return;
  }
  if (subcommand === 'fetch') {
    const { products, offline } = parseFetchArguments(args.slice(1));
    log(JSON.stringify(await fetchQuotaProducts(products, {
      environment,
      home,
      offline: offline || environment.PI_USAGE_OFFLINE === '1',
    })));
    return;
  }
  fail(`Unknown quota subcommand: ${subcommand || '(none)'}`);
}
