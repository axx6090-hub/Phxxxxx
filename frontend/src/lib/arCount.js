// Arabic counting: "منتج واحد", "منتجين", "3 منتجات" (3 to 10 take the plural), "11 منتج".
export const arCount = (n, one, two, few) => {
  const k = Math.abs(n) % 100;
  if (n === 1) return `${one} واحد`;
  if (n === 2) return two;
  if (k >= 3 && k <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
};

export const productsCount = (n) => (n === 0 ? "0 منتج" : arCount(n, "منتج", "منتجين", "منتجات"));
// For "تم شراء N قطعة في آخر N ساعة" the numbers always show.
export const piecesWord = (n) => (n % 100 >= 3 && n % 100 <= 10 ? "قطع" : "قطعة");
export const hoursWord = (n) => (n % 100 >= 3 && n % 100 <= 10 ? "ساعات" : "ساعة");
