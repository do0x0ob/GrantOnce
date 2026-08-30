/** 墨 / 蘭 / 青灰：卡片整塊淡洗，不再用左側彩條。 */
export const SURFACE =
  "rounded-[28px] bg-[var(--wash-orchid)] shadow-[0_1px_0_rgba(60,56,53,0.04),0_20px_40px_-28px_rgba(60,56,53,0.18)]";

export const WASH = {
  orchid: "bg-[var(--wash-orchid)]",
  sage: "bg-[var(--wash-sage)]",
  clay: "bg-[var(--wash-clay)]",
  risk: "bg-[var(--wash-risk)]",
  ok: "bg-[var(--wash-ok)]",
} as const;

export const GRANT_WASH: Record<string, string> = {
  jia: WASH.sage,
  yi: WASH.clay,
};
