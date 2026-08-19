const priorities = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info', destination = console) {
  const threshold = priorities[level] ?? priorities.info;
  return Object.fromEntries(
    Object.entries(priorities).map(([name, priority]) => [
      name,
      (message, details = {}) => {
        if (priority < threshold) return;
        const record = { timestamp: new Date().toISOString(), level: name, message, ...details };
        (destination[name] || destination.log).call(destination, JSON.stringify(record));
      },
    ]),
  );
}
