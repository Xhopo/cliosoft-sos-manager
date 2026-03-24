function parseArgs(args) {
  const command = args[0];
  const options = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      const hasValue = next && !next.startsWith('--');

      options[key] = hasValue ? next : true;

      if (hasValue) {
        i++;
      }
      continue;
    }

    positional.push(arg);
  }

  return { command, options, positional };
}

module.exports = {
  parseArgs,
};
