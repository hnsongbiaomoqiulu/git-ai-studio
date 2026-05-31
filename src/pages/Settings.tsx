import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Download,
  ExternalLink,
  Filter,
  Info,
  Loader2,
  LogOut,
  Minimize2,
  Moon,
  Palette,
  Power,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { ALREADY_CHECKING, useUpdate } from "../contexts/UpdateContext";
import { relaunchApp, type UpdateProgressEvent } from "../lib/updater";
import { RadioGroup, RadioItem } from "../components/ui/RadioGroupBar";
import { Switch } from "../components/ui/SwitchToggle";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/PopoverPanel";
import {
  currentGitUserEmail,
  getAppSettings,
  getAutoLaunchStatus,
  getGitAiConfig,
  listEffectiveIgnorePatterns,
  setAppSettings,
  setAutoLaunch,
} from "../lib/api";
import {
  applyTheme,
  loadTheme,
  persistTheme,
  subscribeSystemTheme,
  type Theme,
} from "../lib/theme";
import i18n, { setLanguage, type SupportedLanguage } from "../i18n";
import { LowAiShareToastCard } from "../components/LowAiShareWatcher";
import { DAEMON_RESET_EVENT, clearDaemonSilence } from "../lib/daemonNotifier";
import { REPO_SETUP_GUIDE_OPEN_EVENT } from "../components/RepoSetupGuide";
import {
  LOW_AI_SHARE_DEFAULT_DISMISS_MINUTES,
  LOW_AI_SHARE_DEFAULT_REMIND_INTERVAL_MINUTES,
  LOW_AI_SHARE_DEFAULT_THRESHOLD,
  LOW_AI_SHARE_MAX_DISMISS_MINUTES,
  LOW_AI_SHARE_MAX_REMIND_INTERVAL_MINUTES,
  LOW_AI_SHARE_MIN_DISMISS_MINUTES,
  LOW_AI_SHARE_MIN_REMIND_INTERVAL_MINUTES,
  LOW_AI_SHARE_RESET_EVENT,
  LOW_AI_SHARE_THRESHOLD_OPTIONS,
  clampLowAiShareMinutes,
  clearLowAiShareSilence,
  normalizeLowAiShareTargetEmails,
} from "../lib/lowAiShareNotifier";
import type { AppSettingsPatch, CloseBehavior, EffectiveIgnorePatternsResult } from "../lib/types";
import { DEFAULT_PET_THEME_ID, PET_THEMES } from "../lib/petState";
import { useRouter } from "../router";

type SettingsTabId = "general" | "monitor" | "data";

const SETTINGS_TABS: Array<{ id: SettingsTabId; labelKey: string }> = [
  { id: "general", labelKey: "settings.tabs.general" },
  { id: "monitor", labelKey: "settings.tabs.monitor" },
  { id: "data", labelKey: "settings.tabs.data" },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { navigate } = useRouter();
  const [tab, setTab] = useState<SettingsTabId>("general");
  const settingsQ = useQuery({ queryKey: ["app_settings"], queryFn: getAppSettings });
  const cfgQ = useQuery({ queryKey: ["git_ai_config"], queryFn: getGitAiConfig });
  const gitEmailQ = useQuery({
    queryKey: ["current_git_user_email"],
    queryFn: currentGitUserEmail,
    enabled: settingsQ.data?.notifications?.low_ai_share?.enabled ?? false,
    staleTime: 60_000,
  });

  const [theme, setTheme] = useState<Theme>(() => loadTheme());

  // 用户点 RadioGroup 触发的副作用:仅持久化 + 应用。
  // 不依赖 settingsQ.data?.theme,避免后端 query 刷新时回写自身造成循环写入。
  useEffect(() => {
    persistTheme(theme);
    applyTheme(theme);
    subscribeSystemTheme(theme);
  }, [theme]);

  // 单独把"theme 变化 → 通知后端"做防抖式写入:只在与服务器值不一致时写。
  useEffect(() => {
    const serverTheme = settingsQ.data?.theme ?? null;
    if (settingsQ.isLoading) return;
    if (serverTheme === theme) return;
    setAppSettings({ theme }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["app_settings"] });
  }, [theme, settingsQ.data?.theme, settingsQ.isLoading, qc]);

  const closeBehaviorM = useMutation({
    mutationFn: (b: CloseBehavior) => setAppSettings({ close_behavior: b }),
    onSuccess: (_, b) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(
        b === "tray"
          ? t("settings.closeBehavior.toastTray")
          : t("settings.closeBehavior.toastExit"),
      );
    },
    onError: (e) =>
      toast.error(t("settings.toast.saveFailed"), { description: (e as Error).message }),
  });
  const closeBehavior: CloseBehavior =
    (settingsQ.data?.close_behavior as CloseBehavior | null) ?? "exit";

  // 开机自启:真源为操作系统登录项,直接读 OS 状态(不落 app config)。
  const autoLaunchQ = useQuery({
    queryKey: ["auto_launch_status"],
    queryFn: getAutoLaunchStatus,
  });
  const autoLaunchM = useMutation({
    mutationFn: (enable: boolean) => setAutoLaunch(enable),
    onSuccess: (enabled) => {
      qc.invalidateQueries({ queryKey: ["auto_launch_status"] });
      toast.success(
        enabled ? t("settings.autoLaunch.toastEnabled") : t("settings.autoLaunch.toastDisabled"),
      );
    },
    onError: (e) =>
      toast.error(t("settings.autoLaunch.toastFailed"), { description: (e as Error).message }),
  });

  // 注:cc_switch_auto_repair 已搬到 notifications 嵌套结构;读取兼容旧顶层字段(后端会迁移)。
  const ccSwitchAutoRepair =
    settingsQ.data?.notifications?.cc_switch_auto_repair ??
    settingsQ.data?.cc_switch_auto_repair ??
    false;
  const ccSwitchM = useMutation({
    mutationFn: (enable: boolean) => setAppSettings({ cc_switch_auto_repair: enable }),
    onSuccess: (_, enable) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(
        enable ? t("settings.ccSwitch.toastEnabled") : t("settings.ccSwitch.toastDisabled"),
      );
    },
    onError: (e) =>
      toast.error(t("settings.toast.saveFailed"), { description: (e as Error).message }),
  });

  // ===== 低 AI 占比提醒 =====
  const lowAi = settingsQ.data?.notifications?.low_ai_share;
  const lowAiEnabled = lowAi?.enabled ?? false;
  const lowAiThreshold = lowAi?.threshold_percent ?? LOW_AI_SHARE_DEFAULT_THRESHOLD;
  const lowAiTargetEmails = normalizeLowAiShareTargetEmails(lowAi?.target_emails ?? []);
  const lowAiTargetEmailsText = lowAiTargetEmails.join("\n");
  const lowAiRemindInterval = clampLowAiShareMinutes(
    lowAi?.remind_interval_minutes,
    LOW_AI_SHARE_DEFAULT_REMIND_INTERVAL_MINUTES,
    LOW_AI_SHARE_MIN_REMIND_INTERVAL_MINUTES,
    LOW_AI_SHARE_MAX_REMIND_INTERVAL_MINUTES,
  );
  const lowAiDismissMinutes = clampLowAiShareMinutes(
    lowAi?.dismiss_minutes,
    LOW_AI_SHARE_DEFAULT_DISMISS_MINUTES,
    LOW_AI_SHARE_MIN_DISMISS_MINUTES,
    LOW_AI_SHARE_MAX_DISMISS_MINUTES,
  );
  const lowAiEnableM = useMutation({
    mutationFn: (enable: boolean) => setAppSettings({ low_ai_share_enabled: enable }),
    onSuccess: (_, enable) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(enable ? t("settings.lowAi.toastEnabled") : t("settings.lowAi.toastDisabled"));
    },
    onError: (e) =>
      toast.error(t("settings.toast.saveFailed"), { description: (e as Error).message }),
  });
  const lowAiThresholdM = useMutation({
    mutationFn: (n: number) => setAppSettings({ low_ai_share_threshold_percent: n }),
    onSuccess: (_, n) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(t("settings.lowAi.toastThresholdSaved", { n }));
    },
    onError: (e) =>
      toast.error(t("settings.toast.saveFailed"), { description: (e as Error).message }),
  });
  const lowAiTargetEmailsM = useMutation({
    mutationFn: (emails: string[]) => setAppSettings({ low_ai_share_target_emails: emails }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(t("settings.lowAi.toastEmailsSaved"));
    },
    onError: (e) =>
      toast.error(t("settings.lowAi.toastEmailsSaveFailed"), { description: (e as Error).message }),
  });
  const lowAiRemindIntervalM = useMutation({
    mutationFn: (minutes: number) =>
      setAppSettings({ low_ai_share_remind_interval_minutes: minutes }),
    onSuccess: (_, minutes) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(t("settings.lowAi.toastRemindIntervalSaved", { minutes }));
    },
    onError: (e) =>
      toast.error(t("settings.lowAi.toastRemindIntervalSaveFailed"), {
        description: (e as Error).message,
      }),
  });
  const lowAiDismissMinutesM = useMutation({
    mutationFn: (minutes: number) => setAppSettings({ low_ai_share_dismiss_minutes: minutes }),
    onSuccess: (_, minutes) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(t("settings.lowAi.toastDismissMinutesSaved", { minutes }));
    },
    onError: (e) =>
      toast.error(t("settings.lowAi.toastDismissMinutesSaveFailed"), {
        description: (e as Error).message,
      }),
  });
  // 实时触发开关:null = 走前端默认 true(向后兼容老配置无此字段的场景)
  const lowAiRealtime = lowAi?.realtime_enabled ?? true;
  const lowAiRealtimeM = useMutation({
    mutationFn: (enable: boolean) => setAppSettings({ low_ai_share_realtime_enabled: enable }),
    onSuccess: (_, enable) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(
        enable
          ? t("settings.lowAi.toastRealtimeEnabled")
          : t("settings.lowAi.toastRealtimeDisabled"),
      );
    },
    onError: (e) =>
      toast.error(t("settings.lowAi.toastRealtimeSaveFailed"), {
        description: (e as Error).message,
      }),
  });
  const [targetEmailsDraft, setTargetEmailsDraft] = useState("");
  useEffect(() => {
    setTargetEmailsDraft(lowAiTargetEmailsText);
  }, [lowAiTargetEmailsText]);
  // 当前阈值是否落在预设档:落在 → 高亮对应档;不在 → 视为自定义并展开输入框。
  const isPresetThreshold = (LOW_AI_SHARE_THRESHOLD_OPTIONS as readonly number[]).includes(
    lowAiThreshold,
  );
  const [customThresholdOpen, setCustomThresholdOpen] = useState(false);
  const [customThresholdDraft, setCustomThresholdDraft] = useState("");
  const showCustomThreshold = customThresholdOpen || !isPresetThreshold;
  const commitCustomThreshold = () => {
    const n = Math.round(Number(customThresholdDraft));
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      toast.error(t("settings.lowAi.thresholdRangeError"));
      return;
    }
    lowAiThresholdM.mutate(n);
  };
  const saveTargetEmails = () => {
    lowAiTargetEmailsM.mutate(normalizeLowAiShareTargetEmails(targetEmailsDraft));
  };
  const saveRemindInterval = (minutes: number) => {
    lowAiRemindIntervalM.mutate(
      clampLowAiShareMinutes(
        minutes,
        LOW_AI_SHARE_DEFAULT_REMIND_INTERVAL_MINUTES,
        LOW_AI_SHARE_MIN_REMIND_INTERVAL_MINUTES,
        LOW_AI_SHARE_MAX_REMIND_INTERVAL_MINUTES,
      ),
    );
  };
  const saveDismissMinutes = (minutes: number) => {
    lowAiDismissMinutesM.mutate(
      clampLowAiShareMinutes(
        minutes,
        LOW_AI_SHARE_DEFAULT_DISMISS_MINUTES,
        LOW_AI_SHARE_MIN_DISMISS_MINUTES,
        LOW_AI_SHARE_MAX_DISMISS_MINUTES,
      ),
    );
  };
  // 测试按钮:用当前阈值 + 一个明显低于阈值的示例占比,完整复刻真实提醒外观。
  // 不写 localStorage / 不进冷却,纯预览,不影响真实提醒节奏。
  const handleTestLowAiToast = () => {
    const exampleShare = Math.max(0, lowAiThreshold - 5);
    // 纯预览:与真实提醒共用 LowAiShareToastCard,onView/onDismiss 为 no-op,
    // 不写 localStorage、不进冷却,仅复刻外观与"必须点击才关"行为。
    // 固定 id:连点「测试一下」时 sonner 会复用同一条 toast 而不是叠加多条预览。
    toast.custom(
      (id) => (
        <LowAiShareToastCard
          title={t("lowAiShare.toastTitleWithRepoTemplate", {
            pct: exampleShare,
            threshold: lowAiThreshold,
            repoName: t("settings.lowAi.previewRepoName"),
          })}
          description={t("lowAiShare.toastDescription")}
          onView={() => {}}
          onDismiss={() => {}}
          onClose={() => toast.dismiss(id)}
        />
      ),
      { duration: Infinity, unstyled: true, id: "low-ai-share:test-preview" },
    );
  };

  // ===== task #7:daemon 异常告警独立总开关 =====
  const daemonAlert = settingsQ.data?.notifications?.daemon_unhealthy_alert ?? false;
  const daemonAlertM = useMutation({
    mutationFn: (enable: boolean) => setAppSettings({ daemon_unhealthy_alert: enable }),
    onSuccess: (_, enable) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(
        enable ? t("settings.daemon.toastAlertEnabled") : t("settings.daemon.toastAlertDisabled"),
      );
    },
    onError: (e) =>
      toast.error(t("settings.toast.saveFailed"), { description: (e as Error).message }),
  });
  // ===== 桌面宠物(Ink pet)=====
  const petEnabled = settingsQ.data?.pet?.enabled ?? false;
  const petThemeId = settingsQ.data?.pet?.theme_id ?? DEFAULT_PET_THEME_ID;
  const petSize = settingsQ.data?.pet?.size ?? "medium";
  const petOpacity = settingsQ.data?.pet?.opacity ?? 1;
  const petAlertSec = settingsQ.data?.pet?.alert_interval_sec ?? 30;
  // 透明度拖动期间走本地草稿,松手才提交,避免每帧打一次 setAppSettings。
  const [petOpacityDraft, setPetOpacityDraft] = useState<number | null>(null);
  const petOpacityValue = petOpacityDraft ?? petOpacity;
  const petEnableM = useMutation({
    mutationFn: (enable: boolean) => setAppSettings({ pet_enabled: enable }),
    onSuccess: (_, enable) => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(enable ? i18n.t("pet.toast.enabled") : i18n.t("pet.toast.disabled"));
    },
    onError: (e) =>
      toast.error(t("settings.toast.saveFailed"), { description: (e as Error).message }),
  });
  // 主题 / 大小 / 透明度 / 提醒间隔共用一个增量 patch mutation。
  const petPatchM = useMutation({
    mutationFn: (patch: AppSettingsPatch) => setAppSettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app_settings"] }),
    onError: (e) =>
      toast.error(t("settings.toast.saveFailed"), { description: (e as Error).message }),
  });
  // 分段按钮统一样式(选中高亮 / 未选中描边)。
  const segCls = (active: boolean) =>
    active
      ? "rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
      : "rounded-md border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 dark:border-border dark:hover:bg-slate-800";

  const resetDaemonSilence = () => {
    clearDaemonSilence();
    window.dispatchEvent(new Event(DAEMON_RESET_EVENT));
    toast.success(t("settings.daemon.toastSilenceReset"));
  };

  const resetLowAiSilence = () => {
    clearLowAiShareSilence(null);
    window.dispatchEvent(new Event(LOW_AI_SHARE_RESET_EVENT));
    toast.success(t("settings.lowAi.toastReminderRestored"));
  };

  const autoUpdateEnabled = !(cfgQ.data?.disable_auto_updates ?? false);

  // ===== 客户端自更新(tauri-plugin-updater)=====
  // 应用版本号:从 Tauri 运行时读取,替代硬编码。非 Tauri 环境(浏览器调试)下为空串。
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  const { hasUpdate, updateInfo, updateHandle, isChecking, checkUpdate, resetDismiss } =
    useUpdate();
  const [isDownloading, setIsDownloading] = useState(false);
  // 下载进度:已下载 / 总字节数,用于按钮上的百分比展示。
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number }>({
    downloaded: 0,
    total: 0,
  });

  // 检查更新 / 下载并安装:无更新时仅检查并提示;有更新时下载、安装、重启。
  // 复刻 cc-switch AboutSection.tsx:397-439,省略 portable 分支(本项目无便携版)。
  async function handleCheckOrInstall() {
    if (hasUpdate && updateHandle) {
      setIsDownloading(true);
      setDownloadProgress({ downloaded: 0, total: 0 });
      try {
        resetDismiss();
        await updateHandle.downloadAndInstall((evt: UpdateProgressEvent) => {
          setDownloadProgress((prev) => {
            if (evt.event === "Started") {
              return { downloaded: 0, total: evt.total ?? 0 };
            }
            if (evt.event === "Progress") {
              return { ...prev, downloaded: prev.downloaded + (evt.downloaded ?? 0) };
            }
            return prev;
          });
        });
        await relaunchApp();
      } catch (e) {
        toast.error(i18n.t("update.installFailed"), { description: (e as Error).message });
      } finally {
        setIsDownloading(false);
      }
      return;
    }

    try {
      const available = await checkUpdate();
      if (!available) {
        toast.success(i18n.t("update.upToDate"));
      }
    } catch (e) {
      // 并发检查被哨兵拦下 → 提示"正在检查",不误报为失败。
      if ((e as Error).message === ALREADY_CHECKING) {
        toast.info(i18n.t("update.checkingInProgress"));
      } else {
        toast.error(i18n.t("update.checkFailed"), { description: (e as Error).message });
      }
    }
  }

  const downloadPercent =
    downloadProgress.total > 0
      ? Math.min(100, Math.round((downloadProgress.downloaded / downloadProgress.total) * 100))
      : 0;

  // Tab 隐藏 helper:把每个 section 的 className 拼上 hidden 条件,切 tab 时该 section 直接 hidden。
  // 用 CSS 隐藏而非条件渲染:组件保持 mount,form draft / mutation 状态不丢失。
  const tabClass = (t: SettingsTabId) => (tab === t ? "" : "hidden ");

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">{t("settings.pageTitle")}</h1>
        <p className="mt-0.5 text-xs text-slate-500">{t("settings.pageSubtitle")}</p>
      </div>

      {/* Tab 切换栏。用 hidden className 控制可见性而非条件渲染,切 tab 时组件保持 mount,
          表单 draft / mutation 状态不丢失。 */}
      <nav className="flex items-center gap-1 border-b border-border">
        {SETTINGS_TABS.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => setTab(it.id)}
            className={
              tab === it.id
                ? "border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-foreground"
            }
            aria-selected={tab === it.id}
            role="tab"
          >
            {t(it.labelKey as never)}
          </button>
        ))}
      </nav>

      {/* 外观 — general */}
      <section className={`${tabClass("general")}rounded-lg border border-border bg-card p-4`}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Palette className="h-4 w-4 text-slate-500" /> {t("settings.appearance.title")}
        </h2>
        <RadioGroup value={theme} onValueChange={(v: Theme) => setTheme(v)}>
          <RadioItem value="light">
            <Sun className="h-3.5 w-3.5" /> {t("settings.appearance.light")}
          </RadioItem>
          <RadioItem value="dark">
            <Moon className="h-3.5 w-3.5" /> {t("settings.appearance.dark")}
          </RadioItem>
          <RadioItem value="system">
            <RefreshCw className="h-3.5 w-3.5" /> {t("settings.appearance.system")}
          </RadioItem>
        </RadioGroup>
        <p className="mt-2 text-[11px] text-slate-400">{t("settings.appearance.systemHint")}</p>
      </section>

      {/* 界面语言 — general */}
      <section className={`${tabClass("general")}rounded-lg border border-border bg-card p-4`}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Palette className="h-4 w-4 text-slate-500" /> {i18n.t("settings.language.label")}
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={(i18n.language === "en" ? "en" : "zh-CN") as SupportedLanguage}
            onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-border dark:bg-card"
            aria-label={i18n.t("settings.language.label")}
          >
            <option value="zh-CN">{i18n.t("settings.language.zh_CN")}</option>
            <option value="en">{i18n.t("settings.language.en")}</option>
          </select>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{i18n.t("settings.language.hint")}</p>
      </section>

      {/* 关闭窗口时的行为 — general */}
      <section className={`${tabClass("general")}rounded-lg border border-border bg-card p-4`}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Minimize2 className="h-4 w-4 text-slate-500" /> {t("settings.closeBehavior.title")}
        </h2>
        <RadioGroup
          value={closeBehavior}
          onValueChange={(v: CloseBehavior) => closeBehaviorM.mutate(v)}
        >
          <RadioItem value="exit">
            <LogOut className="h-3.5 w-3.5" /> {t("settings.closeBehavior.exit")}
          </RadioItem>
          <RadioItem value="tray">
            <Minimize2 className="h-3.5 w-3.5" /> {t("settings.closeBehavior.tray")}
          </RadioItem>
        </RadioGroup>
        <p className="mt-2 text-[11px] text-slate-400">{t("settings.closeBehavior.hint")}</p>
      </section>

      {/* 开机自启(应用本体) — general */}
      <section className={`${tabClass("general")}rounded-lg border border-border bg-card p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Power className="h-4 w-4 text-slate-500" /> {t("settings.autoLaunch.title")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{t("settings.autoLaunch.hint")}</p>
            <p className="mt-1 text-[11px] text-slate-400">{t("settings.autoLaunch.subHint")}</p>
          </div>
          <Switch
            checked={autoLaunchQ.data ?? false}
            onCheckedChange={(v) => autoLaunchM.mutate(v)}
            disabled={autoLaunchQ.isLoading || autoLaunchM.isPending}
            aria-label={t("settings.autoLaunch.toggleAria")}
          />
        </div>
      </section>

      {/* cc-switch 守护 — monitor */}
      <section className={`${tabClass("monitor")}rounded-lg border border-border bg-card p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-slate-500" /> {t("settings.ccSwitch.title")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{t("settings.ccSwitch.hint")}</p>
            <p className="mt-1 text-[11px] text-slate-400">{t("settings.ccSwitch.subHint")}</p>
          </div>
          <Switch
            checked={ccSwitchAutoRepair}
            onCheckedChange={(v) => ccSwitchM.mutate(v)}
            disabled={ccSwitchM.isPending}
            aria-label={t("settings.ccSwitch.toggleAria")}
          />
        </div>
      </section>

      {/* 桌面宠物 — monitor */}
      <section className={`${tabClass("monitor")}rounded-lg border border-border bg-card p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-slate-500" /> {i18n.t("pet.settings.title")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{i18n.t("pet.settings.hint")}</p>
          </div>
          <Switch
            checked={petEnabled}
            onCheckedChange={(v) => petEnableM.mutate(v)}
            disabled={petEnableM.isPending}
            aria-label={i18n.t("pet.settings.title")}
          />
        </div>
        {petEnabled && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {/* 形象主题 */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">
                  {i18n.t("pet.settings.themeLabel")}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {i18n.t("pet.settings.themeHint")}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {PET_THEMES.map((th) => (
                  <button
                    key={th.id}
                    type="button"
                    onClick={() => petPatchM.mutate({ pet_theme_id: th.id })}
                    disabled={petPatchM.isPending}
                    className={`inline-flex items-center gap-1.5 ${segCls(petThemeId === th.id)}`}
                  >
                    <img src={th.images.idle} alt="" className="h-4 w-4 object-contain" />
                    {i18n.t(`pet.settings.themes.${th.id}` as never)}
                  </button>
                ))}
              </div>
            </div>
            {/* 大小 */}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-foreground">
                {i18n.t("pet.settings.sizeLabel")}
              </div>
              <div className="flex gap-1.5">
                {(["small", "medium", "large"] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => petPatchM.mutate({ pet_size: sz })}
                    disabled={petPatchM.isPending}
                    className={segCls(petSize === sz)}
                  >
                    {i18n.t(`pet.settings.sizes.${sz}`)}
                  </button>
                ))}
              </div>
            </div>
            {/* 透明度 */}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-foreground">
                {i18n.t("pet.settings.opacityLabel")}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={20}
                  max={100}
                  step={5}
                  value={Math.round(petOpacityValue * 100)}
                  onChange={(e) => setPetOpacityDraft(Number(e.target.value) / 100)}
                  onMouseUp={() => {
                    if (petOpacityDraft != null) petPatchM.mutate({ pet_opacity: petOpacityDraft });
                  }}
                  onTouchEnd={() => {
                    if (petOpacityDraft != null) petPatchM.mutate({ pet_opacity: petOpacityDraft });
                  }}
                  className="w-32 accent-primary"
                  aria-label={i18n.t("pet.settings.opacityLabel")}
                />
                <span className="w-9 text-right text-xs tabular-nums text-slate-500">
                  {Math.round(petOpacityValue * 100)}%
                </span>
              </div>
            </div>
            {/* 醒目提醒间隔 */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">
                  {i18n.t("pet.settings.alertLabel")}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {i18n.t("pet.settings.alertHint")}
                </p>
              </div>
              <div className="flex gap-1.5">
                {[0, 30, 60, 120].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => petPatchM.mutate({ pet_alert_interval_sec: sec })}
                    disabled={petPatchM.isPending}
                    className={segCls(petAlertSec === sec)}
                  >
                    {sec === 0 ? i18n.t("pet.settings.alertOff") : `${sec}s`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 扫描根目录 — data */}
      <section className={`${tabClass("data")}rounded-lg border border-border bg-card p-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("settings.scanRoots.title")}</h2>
          <button onClick={() => navigate("repo")} className="text-xs text-primary hover:underline">
            {t("settings.scanRoots.manage")}
          </button>
        </div>
        <ul className="mt-2 space-y-0.5 text-xs">
          {(settingsQ.data?.scan_roots ?? []).length === 0 && (
            <li className="text-slate-500">{t("settings.scanRoots.empty")}</li>
          )}
          {(settingsQ.data?.scan_roots ?? []).map((r) => (
            <li key={r} className="truncate font-mono text-slate-600 dark:text-slate-400">
              {r}
            </li>
          ))}
        </ul>
      </section>

      {/* 当前生效的 ignore patterns — data */}
      <div className={tabClass("data") || undefined}>
        <EffectiveIgnoreCard />
      </div>

      {/* 通知大块(低 AI / daemon)— monitor */}
      <section className={`${tabClass("monitor")}rounded-lg border border-border bg-card p-4`}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Bell className="h-4 w-4 text-slate-500" /> {t("settings.notifications.title")}
        </h2>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {t("lowAiShare.settingsTitle")}
                {/* 6 条触发规则收进点击 ⓘ(同 People「作者归因」),按需查看而非常驻占地。 */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("settings.lowAi.rulesAria", {
                        title: t("lowAiShare.settingsTitle"),
                      })}
                      aria-haspopup="dialog"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96">
                    <div className="mb-1.5 text-xs font-medium text-foreground">
                      {t("lowAiShare.rulesTitle")}
                    </div>
                    <ul className="list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-muted-foreground">
                      {(t("lowAiShare.rules", { returnObjects: true }) as string[]).map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{t("lowAiShare.settingsHint")}</p>
            </div>
            <Switch
              checked={lowAiEnabled}
              onCheckedChange={(v) => lowAiEnableM.mutate(v)}
              disabled={lowAiEnableM.isPending}
              aria-label={t("settings.lowAi.toggleAria")}
            />
          </div>
          {lowAiEnabled && (
            <div className="space-y-2 pl-1">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-slate-500">{t("lowAiShare.thresholdLabel")}</label>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {LOW_AI_SHARE_THRESHOLD_OPTIONS.map((n) => {
                    const active = !showCustomThreshold && lowAiThreshold === n;
                    return (
                      <button
                        key={n}
                        onClick={() => {
                          setCustomThresholdOpen(false);
                          lowAiThresholdM.mutate(n);
                        }}
                        disabled={lowAiThresholdM.isPending}
                        className={
                          active
                            ? "rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary dark:bg-primary/10 dark:text-primary"
                            : "rounded-md border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 dark:border-border dark:hover:bg-slate-800"
                        }
                      >
                        {n}%
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      setCustomThresholdDraft(String(lowAiThreshold));
                      setCustomThresholdOpen(true);
                    }}
                    disabled={lowAiThresholdM.isPending}
                    className={
                      showCustomThreshold
                        ? "rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary dark:bg-primary/10 dark:text-primary"
                        : "rounded-md border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 dark:border-border dark:hover:bg-slate-800"
                    }
                  >
                    {t("settings.lowAi.customThreshold")}
                  </button>
                </div>
              </div>
              {showCustomThreshold && (
                <div className="flex items-center justify-end gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={customThresholdDraft}
                    onChange={(e) => setCustomThresholdDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitCustomThreshold();
                    }}
                    placeholder={String(lowAiThreshold)}
                    className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-border dark:bg-card"
                  />
                  <span className="text-xs text-slate-500">%</span>
                  <button
                    onClick={commitCustomThreshold}
                    disabled={lowAiThresholdM.isPending}
                    className="rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary dark:bg-primary/10 dark:text-primary"
                  >
                    {t("settings.lowAi.saveThreshold")}
                  </button>
                </div>
              )}
              <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground">
                    {t("settings.lowAi.realtimeLabel")}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {t("settings.lowAi.realtimeHint")}
                  </p>
                </div>
                <Switch
                  checked={lowAiRealtime}
                  onCheckedChange={(v) => lowAiRealtimeM.mutate(v)}
                  disabled={lowAiRealtimeM.isPending}
                  aria-label={t("settings.lowAi.realtimeToggleAria")}
                />
              </div>
              <div className="grid gap-2 rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label className="text-xs font-medium text-foreground">
                      {t("lowAiShare.targetEmailsLabel")}
                    </label>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {t("lowAiShare.targetEmailsHelp")}
                    </p>
                    {targetEmailsDraft.trim().length === 0 && (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {t("settings.lowAi.currentAutoEmail")}
                        <span className="ml-1 font-mono">
                          {gitEmailQ.data ?? t("settings.lowAi.autoEmailUnavailable")}
                        </span>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={saveTargetEmails}
                    disabled={lowAiTargetEmailsM.isPending}
                    className="rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary dark:bg-primary/10 dark:text-primary"
                  >
                    {t("settings.lowAi.saveEmails")}
                  </button>
                </div>
                <textarea
                  value={targetEmailsDraft}
                  onChange={(e) => setTargetEmailsDraft(e.target.value)}
                  placeholder={t("lowAiShare.targetEmailsPlaceholder")}
                  rows={3}
                  className="min-h-20 resize-y rounded-md border border-slate-200 px-2 py-1.5 font-mono text-xs dark:border-border dark:bg-card"
                />
              </div>
              {/* 间隔/静默统一为 chip+自定义(对齐上方阈值),与「测试 / 重新开启」收进一个盒子。 */}
              <div className="grid gap-3 rounded-md border border-border p-3">
                <ChipPicker
                  label={t("lowAiShare.remindIntervalLabel")}
                  value={lowAiRemindInterval}
                  min={LOW_AI_SHARE_MIN_REMIND_INTERVAL_MINUTES}
                  max={LOW_AI_SHARE_MAX_REMIND_INTERVAL_MINUTES}
                  onSave={saveRemindInterval}
                  disabled={lowAiRemindIntervalM.isPending}
                  presets={[
                    [t("lowAiShare.dur15min"), 15],
                    [t("lowAiShare.dur1hr"), 60],
                    [t("lowAiShare.dur6hr"), 360],
                    [t("lowAiShare.dur24hr"), 1440],
                  ]}
                />
                <ChipPicker
                  label={t("lowAiShare.dismissMinutesLabel")}
                  value={lowAiDismissMinutes}
                  min={LOW_AI_SHARE_MIN_DISMISS_MINUTES}
                  max={LOW_AI_SHARE_MAX_DISMISS_MINUTES}
                  onSave={saveDismissMinutes}
                  disabled={lowAiDismissMinutesM.isPending}
                  presets={[
                    [t("lowAiShare.dur1hr"), 60],
                    [t("lowAiShare.dur6hr"), 360],
                    [t("lowAiShare.dur24hr"), 1440],
                    [t("lowAiShare.dur7day"), 10080],
                  ]}
                />
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                  <button
                    onClick={handleTestLowAiToast}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 dark:border-border dark:hover:bg-slate-800"
                  >
                    {t("lowAiShare.testReminder")}
                  </button>
                  <button
                    onClick={resetLowAiSilence}
                    className="text-xs text-slate-500 hover:text-foreground hover:underline"
                  >
                    {t("lowAiShare.resetReminder")}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t("settings.daemon.title")}</div>
              <p className="mt-0.5 text-xs text-slate-500">{t("settings.daemon.hint")}</p>
              <p className="mt-1 text-[11px] text-slate-400">{t("settings.daemon.subHint")}</p>
            </div>
            <Switch
              checked={daemonAlert}
              onCheckedChange={(v) => daemonAlertM.mutate(v)}
              disabled={daemonAlertM.isPending}
              aria-label={t("settings.daemon.toggleAria")}
            />
          </div>
          {daemonAlert && (
            <div className="flex items-center justify-end rounded-md border border-border p-3">
              <button
                type="button"
                onClick={resetDaemonSilence}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] hover:bg-slate-50 dark:border-border dark:hover:bg-slate-800"
              >
                {t("settings.daemon.resetSilence")}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* git-ai 自动更新(readonly + 跳转)— data */}
      <section className={`${tabClass("data")}rounded-lg border border-border bg-card p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">{t("settings.gitAiUpdate.title")}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {t("settings.gitAiUpdate.statusLabel", {
                status: autoUpdateEnabled
                  ? t("settings.gitAiUpdate.statusEnabled")
                  : t("settings.gitAiUpdate.statusDisabled"),
              })}
            </p>
          </div>
          <button
            onClick={() => navigate("install")}
            className="text-xs text-primary hover:underline"
          >
            {t("settings.gitAiUpdate.goEdit")}
          </button>
        </div>
      </section>

      {/* 首次引导 — general */}
      <section className={`${tabClass("general")}rounded-lg border border-border bg-card p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium">{t("settings.onboarding.title")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("settings.onboarding.hint")}</p>
          </div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(REPO_SETUP_GUIDE_OPEN_EVENT))}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-border dark:hover:bg-slate-800"
          >
            {t("settings.onboarding.reopen")}
          </button>
        </div>
      </section>

      {/* 关于 — general(放最末) */}
      <section
        className={`${tabClass("general")}rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500 dark:border-border dark:bg-card`}
      >
        <div className="font-medium text-foreground/80">{t("settings.about.title")}</div>
        <div className="mt-1">git-ai-studio{appVersion ? ` v${appVersion}` : ""}</div>
        <div>
          {t("settings.about.sourceCode")}
          <a
            href="https://github.com/bujueyunjian/git-ai-studio"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            bujueyunjian/git-ai-studio <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleCheckOrInstall}
            disabled={isDownloading || isChecking}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-foreground hover:bg-slate-50 disabled:opacity-60 dark:border-border dark:hover:bg-slate-800"
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {downloadProgress.total > 0
                  ? i18n.t("update.downloadingPercent", { percent: downloadPercent })
                  : i18n.t("update.downloading")}
              </>
            ) : isChecking ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {i18n.t("update.checking")}
              </>
            ) : hasUpdate && updateInfo ? (
              <>
                <Download className="h-3.5 w-3.5" />
                {i18n.t("update.downloadAndInstall", {
                  version: updateInfo.availableVersion,
                })}
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                {i18n.t("update.checkForUpdates")}
              </>
            )}
          </button>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">{t("settings.about.privacy")}</div>
      </section>
    </div>
  );
}

/** 分钟数值设置:一排预设 chip + 自定义展开输入,与上方阈值选择器同款交互。
 *  点预设即存;点"自定义"展开数字框,回车 / 保存提交。统一守护与通知页的数值设置体验。 */
function ChipPicker({
  label,
  value,
  presets,
  min,
  max,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  presets: Array<[string, number]>;
  min: number;
  max: number;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const { t } = useTranslation();
  const matchesPreset = (v: number) => presets.some(([, m]) => m === v);
  const [customOpen, setCustomOpen] = useState(!matchesPreset(value));
  const [draft, setDraft] = useState(String(value));
  // 外部值变化(切换、后端回写)时同步:命中预设则收起自定义,否则保持展开。
  useEffect(() => {
    setDraft(String(value));
    setCustomOpen(!matchesPreset(value));
    // presets 为稳定常量,无需进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < min || n > max) {
      toast.error(t("lowAiShare.minutesRangeError", { label, min, max }));
      return;
    }
    onSave(n);
  };

  const chipOn =
    "rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary dark:bg-primary/10 dark:text-primary";
  const chipOff =
    "rounded-md border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50 dark:border-border dark:hover:bg-slate-800";

  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-slate-500">{label}</label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {presets.map(([text, minutes]) => {
          const active = !customOpen && value === minutes;
          return (
            <button
              key={minutes}
              onClick={() => {
                setCustomOpen(false);
                onSave(minutes);
              }}
              disabled={disabled}
              className={active ? chipOn : chipOff}
            >
              {text}
            </button>
          );
        })}
        <button
          onClick={() => {
            setDraft(String(value));
            setCustomOpen(true);
          }}
          disabled={disabled}
          className={customOpen ? chipOn : chipOff}
        >
          {t("lowAiShare.custom")}
        </button>
        {customOpen && (
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={min}
              max={max}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
              className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-border dark:bg-card"
            />
            <button onClick={commit} disabled={disabled} className={chipOn}>
              {t("lowAiShare.save")}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

// ============ P11-C 当前生效 ignore patterns ============

function EffectiveIgnoreCard() {
  const { t } = useTranslation();
  const q = useQuery<EffectiveIgnorePatternsResult>({
    queryKey: ["effective_ignore_patterns"],
    queryFn: listEffectiveIgnorePatterns,
    // 不主动跑:用户点"重新读取"按钮时才查;避免每次进 Settings 页都拉一次子进程
    enabled: false,
  });

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Filter className="h-4 w-4 text-slate-500" /> {t("effectiveIgnore.title")}
          {/* 作用说明收进点击 ⓘ(同 People / 低 AI 规则),不再常驻为标题下灰字。 */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("effectiveIgnore.title")}
                aria-haspopup="dialog"
                className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-96">
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {t("effectiveIgnore.hint")}
              </p>
            </PopoverContent>
          </Popover>
        </h2>
        <button
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50 dark:border-border dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-3 w-3 ${q.isFetching ? "animate-spin" : ""}`} />
          {q.isFetching ? t("effectiveIgnore.refreshing") : t("effectiveIgnore.refresh")}
        </button>
      </div>

      {q.data?.status === "degraded" && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {q.data.reason.kind === "repo_missing"
            ? t("effectiveIgnore.degradedRepoMissing")
            : t("effectiveIgnore.degradedGitAiMissing")}
        </p>
      )}

      {q.isError && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
          {(q.error as Error).message}
        </p>
      )}

      {q.data?.status === "ok" && (
        <div className="mt-2">
          <div className="text-[11px] text-slate-500">
            {t("settings.effectiveIgnore.repoPrefix")}
            <span className="font-mono">{q.data.payload.repo_path}</span>{" "}
            {t("settings.effectiveIgnore.patternCount", { count: q.data.payload.patterns.length })}
          </div>
          {q.data.payload.patterns.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">{t("effectiveIgnore.listEmpty")}</p>
          ) : (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded-sm border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] dark:border-border dark:bg-background">
              {q.data.payload.patterns.map((p, i) => (
                <li key={`${p}-${i}`} className="truncate">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
