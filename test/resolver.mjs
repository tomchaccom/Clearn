let MAP = {};
export function initialize(data) {
  MAP = data ?? {};
}
export function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return next(specifier, context);
}
