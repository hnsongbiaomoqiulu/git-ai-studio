// i18next 类型增强:把 en.json 的结构喂给 TS,使 `t("key")` / `i18n.t("key")` 获得
// key 级类型检查与 IDE 自动补全(写错 key 直接 typecheck 报错)。
//
// en.json 是类型真源(zh-CN.json 必须同结构);keySeparator 与运行时(index.ts)一致为 ".".
import "i18next";

import type enResources from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof enResources };
    keySeparator: ".";
  }
}
