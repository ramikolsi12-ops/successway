import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { formatMoney } from "@/lib/format";

describe("Dinars à trois décimales", () => {
  it("additionne exactement les millimes", () => { expect(money("0.100").plus(money("0.200")).toFixed(3)).toBe("0.300"); });
  it("calcule les soldes partiels", () => { expect(money("600.000").minus(money("350.125")).toFixed(3)).toBe("249.875"); });
  it("conserve la précision sur les grands montants", () => { expect(money("99999999999.999").minus("0.001").toFixed(3)).toBe("99999999999.998"); });
  it("refuse la précision implicite supérieure à trois décimales", () => { expect(() => money("1.0001")).toThrow(); });
  it("affiche les dinars et millimes en français", () => { expect(formatMoney("50.000")).toBe("50,000 DT"); expect(formatMoney("0.001")).toBe("0,001 DT"); });
});
