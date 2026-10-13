// A four-function calculator as a pure state machine (the on-screen calculator of company-style tests).

export interface CalcState {
  /** What the screen shows. */
  display: string;
  /** The left operand once an operator was pressed. */
  acc: number | null;
  op: "+" | "-" | "*" | "/" | null;
  /** The next digit starts a fresh number. */
  fresh: boolean;
}

export const INITIAL_CALC: CalcState = { display: "0", acc: null, op: null, fresh: true };

const apply = (a: number, op: NonNullable<CalcState["op"]>, b: number): number | null => {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? null : a / b;
  }
};

/** Up to 10 significant digits, without trailing zeros. */
const show = (n: number): string => String(Number(n.toPrecision(10)));

export function calcPress(s: CalcState, key: string): CalcState {
  if (s.display === "Error" && key !== "Clear") {
    s = INITIAL_CALC;
  }
  if (/^[0-9]$/.test(key)) {
    if (s.fresh) return { ...s, display: key, fresh: false };
    return { ...s, display: s.display === "0" ? key : (s.display + key).slice(0, 14) };
  }
  if (key === ".") {
    if (s.fresh) return { ...s, display: "0.", fresh: false };
    return s.display.includes(".") ? s : { ...s, display: `${s.display}.` };
  }
  if (key === "+" || key === "-" || key === "*" || key === "/") {
    const current = Number(s.display);
    if (s.op && s.acc !== null && !s.fresh) {
      const r = apply(s.acc, s.op, current);
      if (r === null) return { display: "Error", acc: null, op: null, fresh: true };
      return { display: show(r), acc: r, op: key, fresh: true };
    }
    return { ...s, acc: current, op: key, fresh: true };
  }
  if (key === "=") {
    if (!s.op || s.acc === null) return s;
    const r = apply(s.acc, s.op, Number(s.display));
    if (r === null) return { display: "Error", acc: null, op: null, fresh: true };
    return { display: show(r), acc: null, op: null, fresh: true };
  }
  return s;
}
