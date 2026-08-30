import type { FieldId } from "./types";

export const FIELD_META: Record<
  FieldId,
  { label: string; group: string; sealed?: boolean; note: string }
> = {
  "household.city": {
    label: "現戶籍縣市",
    group: "戶籍",
    note: "遷徙後的戶籍地",
  },
  "household.address": {
    label: "戶籍地址",
    group: "戶籍",
    note: "合成地址，非正式謄本",
  },
  "household.previousCity": {
    label: "遷出縣市",
    group: "戶籍",
    note: "用來證明剛搬家",
  },
  "household.moveDate": {
    label: "遷入日期",
    group: "戶籍",
    note: "最近一次遷徙",
  },
  "household.householdId": {
    label: "戶號（合成）",
    group: "戶籍",
    note: "假資料，非正式戶號",
  },
  "parentChild.childName": {
    label: "子女姓名",
    group: "親子關係",
    note: "合成姓名",
  },
  "parentChild.childBirthDate": {
    label: "子女出生日期",
    group: "親子關係",
    note: "用來計算 0–2 歲資格",
  },
  "parentChild.relation": {
    label: "稱謂",
    group: "親子關係",
    note: "與申請人關係",
  },
  "income.annualIncome": {
    label: "綜合所得總額",
    group: "所得",
    sealed: true,
    note: "金庫有此筆，快樂路徑絕不授權",
  },
  "income.taxYear": {
    label: "所得年度",
    group: "所得",
    sealed: true,
    note: "金庫有此筆，快樂路徑絕不授權",
  },
  "nhi.cardId": {
    label: "健保卡號（合成）",
    group: "健保",
    note: "金庫有此筆，本次申請未請求",
  },
  "nhi.status": {
    label: "加保狀態",
    group: "健保",
    note: "金庫有此筆，本次申請未請求",
  },
  "taipower.meterId": {
    label: "電表號",
    group: "台電",
    note: "住戶用電識別",
  },
  "taipower.usage.m1": {
    label: "用電量（2026-05）",
    group: "台電",
    note: "近三月之一",
  },
  "taipower.usage.m2": {
    label: "用電量（2026-06）",
    group: "台電",
    note: "近三月之二",
  },
  "taipower.usage.m3": {
    label: "用電量（2026-07）",
    group: "台電",
    note: "近三月之三",
  },
};

export function isFieldId(value: string): value is FieldId {
  return Object.hasOwn(FIELD_META, value);
}
