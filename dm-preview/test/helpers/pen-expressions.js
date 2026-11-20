export const evaluate = (value, props = {}, zoom = 0) => {
  if (!Array.isArray(value)) return value;
  const [op, ...args] = value;
  if (op === "get") return props[args[0]];
  if (op === "literal") return args[0];
  if (op === "==") return evaluate(args[0], props, zoom) === evaluate(args[1], props, zoom);
  if (op === "*") return args.reduce((result, arg) => result * evaluate(arg, props, zoom), 1);
  if (op === "case") { for (let i = 0; i < args.length - 1; i += 2) if (evaluate(args[i], props, zoom)) return evaluate(args[i + 1], props, zoom); return evaluate(args.at(-1), props, zoom); }
  if (op === "match") { const input = evaluate(args[0], props, zoom); for (let i = 1; i < args.length - 1; i += 2) if ([args[i]].flat().includes(input)) return evaluate(args[i + 1], props, zoom); return evaluate(args.at(-1), props, zoom); }
  if (op === "interpolate") {
    const [, , ...stops] = args;
    if (zoom <= stops[0]) return evaluate(stops[1], props, zoom);
    for (let i = 2; i < stops.length; i += 2) if (zoom <= stops[i]) {
      const ratio = (2 ** (zoom - stops[i - 2]) - 1) / (2 ** (stops[i] - stops[i - 2]) - 1);
      return evaluate(stops[i - 1], props, zoom) * (1 - ratio) + evaluate(stops[i + 1], props, zoom) * ratio;
    }
    return evaluate(stops.at(-1), props, zoom);
  }
  throw new Error(`unhandled expression: ${op}`);
};
